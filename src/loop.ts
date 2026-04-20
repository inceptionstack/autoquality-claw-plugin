import type { ReviewRules } from "./rules.js";
import type { Decision, Edit, LoopHistoryItem, LoopOutcome, ReviewResult, RollupKey } from "./types.js";

export type AutoLoopInput = {
  rules: ReviewRules;
  rollupKey: RollupKey;
  parentSessionKey?: string;
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
};

const getNow = (): number => Date.now();

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

export async function runAutoLoop(input: AutoLoopInput): Promise<LoopOutcome> {
  const history: LoopHistoryItem[] = [];
  const deadline = getNow() + input.loopTimeoutMs;
  let iteration = 0;

  while (true) {
    if (input.abortSignal?.aborted) {
      return { status: "aborted", history, iterations: iteration };
    }

    if (getNow() > deadline) {
      return { status: "timeout", history, iterations: iteration };
    }

    if (iteration >= input.maxIterations) {
      return { status: "max-iterations", history, iterations: iteration };
    }

    iteration += 1;
    input.setIteration(input.rollupKey, iteration);
    input.liveness?.(`auto-claw: iteration ${iteration}`);

    let decision: Decision;

    try {
      decision = await input.gatekeeper.decide({
        rules: input.rules,
        edits: input.getEdits(input.rollupKey),
        history,
        iteration,
        lastReplyText: input.lastReplyText,
      });
    } catch (error) {
      history.push({ kind: "error", iteration, error: `gatekeeper: ${String(error)}` });
      return { status: "error", history, iterations: iteration };
    }

    history.push({ kind: "decision", iteration, decision });

    if (decision.action === "approve") {
      return { status: "approved", history, iterations: iteration };
    }

    if (decision.action === "stop") {
      return { status: "stopped", history, iterations: iteration };
    }

    if (decision.action === "review") {
      input.liveness?.("auto-claw: running reviewer...");

      try {
        const result = await input.review({
          reviewerAgentId: decision.reviewerAgentId,
          reviewerModel: decision.reviewerModel,
          task: buildReviewTask(input.rules, input.getEdits(input.rollupKey), decision.focus),
        });

        history.push({ kind: "review", iteration, result });
      } catch (error) {
        history.push({ kind: "error", iteration, error: `review: ${String(error)}` });
        return { status: "error", history, iterations: iteration };
      }

      continue;
    }

    input.liveness?.("auto-claw: running fixer...");

    const editsBefore = input.getEdits(input.rollupKey).length;

    try {
      const result = await input.fix({
        fixerAgentId: decision.fixerAgentId,
        fixerModel: decision.fixerModel,
        prompt: decision.fixerPrompt,
      });
      const editsAfter = input.getEdits(input.rollupKey).length;

      history.push({
        kind: "fix",
        iteration,
        summary: result.summary,
        editCount: editsAfter - editsBefore,
      });
    } catch (error) {
      history.push({ kind: "error", iteration, error: `fix: ${String(error)}` });
      return { status: "error", history, iterations: iteration };
    }
  }
}
