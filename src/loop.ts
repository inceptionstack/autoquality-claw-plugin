import type { ReviewRules } from "./rules.js";
import type { Decision, Edit, LoopHistoryItem, LoopOutcome, ReviewResult, RollupKey } from "./types.js";

export type AutoLoopInput = {
  rules: ReviewRules;
  rollupKey: RollupKey;
  lastReplyText: string;
  maxIterations: number;
  loopTimeoutMs: number;
  abortSignal?: AbortSignal;
  gatekeeper: {
    decide(input: {
      rules: ReviewRules;
      edits: Edit[];
      history: LoopHistoryItem[];
      iteration: number;
      lastReplyText: string;
    }): Promise<Decision>;
  };
  review: (params: {
    reviewerAgentId?: string;
    reviewerModel?: string;
    task: string;
  }) => Promise<ReviewResult>;
  fix: (params: {
    fixerAgentId?: string;
    fixerModel?: string;
    prompt: string;
  }) => Promise<{ runId: string; childSessionKey: string; summary: string }>;
  setIteration(rollupKey: RollupKey, iteration: number): void;
  getEdits(rollupKey: RollupKey): Edit[];
  liveness?: (message: string) => void;
  // Overridable in tests; production uses Date.now().
  now?: () => number;
  // How long to wait after a fix returns before snapshotting edit count, so
  // late-arriving after_tool_call events have a chance to flush.
  fixSettleMs?: number;
};

const buildReviewTask = (rules: ReviewRules, edits: Edit[], focus?: string): string => {
  const editList = edits.map((edit) => `- ${edit.tool} ${edit.file ?? "?"} iter=${edit.iteration}`).join("\n") || "(none)";

  return [
    "# Code review task",
    focus ? `Focus: ${focus}` : "",
    "",
    "## Reviewer instructions (from review-rules.md)",
    rules.sections.reviewerInstructions,
    "",
    "## Quality gate",
    rules.qualityGate,
    "",
    "## Files changed this loop",
    editList,
    "",
    "Return findings line-by-line, prefixed with `error:`, `warn:`, or `info:`. When possible include `file:line — message`. End with one of: `LGTM`, `Needs fix`, `Uncertain`.",
  ]
    .filter(Boolean)
    .join("\n");
};

type RaceOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "aborted" };

// Race an in-flight promise against abort and the loop deadline. The underlying
// work cannot be cancelled by us, but we can stop waiting on it and unwind the
// loop cleanly so the user never sits on a dead promise. If abort/timeout wins,
// any late rejection from the abandoned work is observed and swallowed here so
// it does not surface as an unhandledRejection.
const raceAwait = async <T>(
  promise: Promise<T>,
  abortSignal: AbortSignal | undefined,
  deadline: number,
  now: () => number,
): Promise<RaceOutcome<T>> => {
  if (abortSignal?.aborted) {
    // Even if we do not wait on it, attach a no-op rejection handler so the
    // promise never becomes an unhandled rejection.
    promise.catch(() => undefined);
    return { kind: "aborted" };
  }
  const remaining = deadline - now();
  if (remaining <= 0) {
    promise.catch(() => undefined);
    return { kind: "timeout" };
  }

  return new Promise<RaceOutcome<T>>((resolve) => {
    let settled = false;
    const settle = (outcome: RaceOutcome<T>): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(outcome);
    };
    const timer = setTimeout(() => settle({ kind: "timeout" }), Math.max(1, remaining));
    const onAbort = (): void => settle({ kind: "aborted" });
    abortSignal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);
        settle({ kind: "ok", value });
      },
      (err) => {
        clearTimeout(timer);
        abortSignal?.removeEventListener("abort", onAbort);
        // Two cases:
        //  - we are the first to settle: wrap the error so the caller's
        //    try/catch sees it (we still have to deliver the error).
        //  - timeout/abort already won: the error is stale but must be
        //    observed to prevent an unhandledRejection. Swallowing it is
        //    correct — the loop already decided to stop waiting on this work.
        if (settled) {
          return;
        }
        settle({ kind: "ok", value: Promise.reject(err) as unknown as T });
      },
    );
  });
};

export async function runAutoLoop(input: AutoLoopInput): Promise<LoopOutcome> {
  const history: LoopHistoryItem[] = [];
  const now = input.now ?? Date.now;
  const deadline = now() + input.loopTimeoutMs;
  // Enforce both the plugin-config cap AND the rules.maxIterations cap.
  // rules.maxIterations of 0 effectively disables the loop (we never enter it).
  const effectiveMax = Math.min(input.maxIterations, input.rules.maxIterations);
  const minIterations = Math.max(0, input.rules.minIterations);
  let iteration = 0;
  // Tracks repeated zero-edit fix decisions so we break out of a fixer that
  // keeps being asked to try but never actually produces edits.
  let consecutiveNoProgress = 0;

  while (true) {
    if (input.abortSignal?.aborted) {
      return { status: "aborted", history, iterations: iteration };
    }

    if (now() > deadline) {
      return { status: "timeout", history, iterations: iteration };
    }

    if (iteration >= effectiveMax) {
      return { status: "max-iterations", history, iterations: iteration };
    }

    iteration += 1;
    input.setIteration(input.rollupKey, iteration);
    input.liveness?.(`auto-claw: iteration ${iteration}`);

    let decision: Decision;

    const decideRace = await raceAwait(
      input.gatekeeper
        .decide({
          rules: input.rules,
          edits: input.getEdits(input.rollupKey),
          history,
          iteration,
          lastReplyText: input.lastReplyText,
        })
        .catch((error) => {
          throw error;
        }),
      input.abortSignal,
      deadline,
      now,
    );

    if (decideRace.kind === "aborted") {
      return { status: "aborted", history, iterations: iteration };
    }
    if (decideRace.kind === "timeout") {
      return { status: "timeout", history, iterations: iteration };
    }

    try {
      decision = await Promise.resolve(decideRace.value);
    } catch (error) {
      history.push({ kind: "error", iteration, error: `gatekeeper: ${String(error)}` });
      return { status: "error", history, iterations: iteration };
    }

    history.push({ kind: "decision", iteration, decision });

    if (decision.action === "approve") {
      // Enforce minIterations only when there are actual edits to review.
      // No-edit turns (pure text replies, read-only work) approve immediately.
      const hasEdits = input.getEdits(input.rollupKey).length > 0;
      const stepsSoFar = history.filter((h) => h.kind === "review" || h.kind === "fix").length;
      if (hasEdits && stepsSoFar < minIterations) {
        history.push({
          kind: "error",
          iteration,
          error: `approve ignored: minIterations=${minIterations} not yet satisfied (steps=${stepsSoFar})`,
        });
        // Fall through: iteration was already incremented; the next pass will
        // re-consult the gatekeeper. This avoids infinite loops because the
        // effectiveMax bound still applies.
        continue;
      }
      return { status: "approved", history, iterations: iteration };
    }

    if (decision.action === "stop") {
      return { status: "stopped", history, iterations: iteration };
    }

    if (decision.action === "review") {
      input.liveness?.("auto-claw: running reviewer...");

      const reviewRace = await raceAwait(
        input.review({
          reviewerAgentId: decision.reviewerAgentId,
          reviewerModel: decision.reviewerModel,
          task: buildReviewTask(input.rules, input.getEdits(input.rollupKey), decision.focus),
        }),
        input.abortSignal,
        deadline,
        now,
      );
      if (reviewRace.kind === "aborted") {
        return { status: "aborted", history, iterations: iteration };
      }
      if (reviewRace.kind === "timeout") {
        return { status: "timeout", history, iterations: iteration };
      }

      try {
        const result = await Promise.resolve(reviewRace.value);
        history.push({ kind: "review", iteration, result });
      } catch (error) {
        history.push({ kind: "error", iteration, error: `review: ${String(error)}` });
        return { status: "error", history, iterations: iteration };
      }

      continue;
    }

    input.liveness?.("auto-claw: running fixer...");

    const editsBefore = input.getEdits(input.rollupKey).length;

    const fixRace = await raceAwait(
      input.fix({
        fixerAgentId: decision.fixerAgentId,
        fixerModel: decision.fixerModel,
        prompt: decision.fixerPrompt,
      }),
      input.abortSignal,
      deadline,
      now,
    );
    if (fixRace.kind === "aborted") {
      return { status: "aborted", history, iterations: iteration };
    }
    if (fixRace.kind === "timeout") {
      return { status: "timeout", history, iterations: iteration };
    }

    try {
      const result = await Promise.resolve(fixRace.value);

      // Give late-arriving after_tool_call events a beat to flush before we
      // snapshot the new edit count. Bounded so tests stay fast.
      const settleMs = Math.max(0, input.fixSettleMs ?? 0);
      if (settleMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, settleMs));
      }

      const editsAfter = input.getEdits(input.rollupKey).length;
      const editCount = editsAfter - editsBefore;

      history.push({
        kind: "fix",
        iteration,
        summary: result.summary,
        editCount,
      });

      if (editCount <= 0) {
        consecutiveNoProgress += 1;
        if (consecutiveNoProgress >= 2) {
          history.push({
            kind: "error",
            iteration,
            error: "no-progress: fixer produced zero edits across consecutive iterations",
          });
          return { status: "stopped", history, iterations: iteration };
        }
      } else {
        consecutiveNoProgress = 0;
      }
    } catch (error) {
      history.push({ kind: "error", iteration, error: `fix: ${String(error)}` });
      return { status: "error", history, iterations: iteration };
    }
  }
}
