import type { AutoClawConfig } from "./config.js";
import { dispatchFix } from "./dispatch-fix.js";
import { dispatchReview } from "./dispatch-review.js";
import { formatFinalMessage } from "./format-output.js";
import { runAutoLoop } from "./loop.js";
import type { PluginLogger } from "./runtime-api.js";
import { parseRules, parseRulesWithWarnings } from "./rules.js";
import type { Decision, Edit, LoopOutcome } from "./types.js";

export type ReplyPayload = {
  text?: string;
  [key: string]: unknown;
};

export type ReplyDispatcher = {
  sendToolResult(payload: ReplyPayload): boolean;
  sendBlockReply(payload: ReplyPayload): boolean;
  sendFinalReply(payload: ReplyPayload): boolean;
  waitForIdle(): Promise<void>;
  getQueuedCounts(): Record<"tool" | "block" | "final", number>;
  getFailedCounts(): Record<"tool" | "block" | "final", number>;
  markComplete(): void;
};

export type ReplyDispatchEvent = {
  ctx?: Record<string, unknown> & {
    finalReply?: ReplyPayload;
    sessionKey?: string;
    workspaceDir?: string;
  };
  runId?: string;
  sessionKey?: string;
  inboundAudio: boolean;
  shouldRouteToOriginating: boolean;
  shouldSendToolSummaries: boolean;
  sendPolicy: "allow" | "deny";
};

export type ReplyDispatchContext = {
  cfg?: Record<string, unknown>;
  dispatcher: ReplyDispatcher;
  abortSignal?: AbortSignal;
  recordProcessed?: (
    outcome: "completed" | "skipped" | "error",
    opts?: { reason?: string; error?: string },
  ) => void;
  markIdle?: (reason: string) => void;
};

export type ReplyDispatchResult = {
  handled: boolean;
  queuedFinal: boolean;
  counts: Record<"tool" | "block" | "final", number>;
};

export type EditsCollectorLike = {
  getEdits(rollupKey: string): Edit[];
  clear(rollupKey: string): void;
  setIteration(rollupKey: string, iteration: number): void;
  onAfterToolCall(event: unknown, ctx: unknown): void;
  snapshot(): Map<string, Edit[]>;
};

export type CreateReplyDispatchHandlerDeps = {
  config: AutoClawConfig;
  runtime: {
    logger: PluginLogger;
    readWorkspaceFile(relativePath: string): Promise<string | null>;
    subagent: {
      run(params: { sessionKey: string; message: string; provider?: string; model?: string; deliver?: boolean }): Promise<{ runId: string }>;
      waitForRun(params: { runId: string; timeoutMs?: number }): Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
      getSessionMessages(params: { sessionKey: string; limit?: number }): Promise<{ messages: unknown[] }>;
    };
  };
  editsCollector: EditsCollectorLike;
  gatekeeper: {
    decide(input: {
      rules: ReturnType<typeof parseRules>;
      edits: Edit[];
      history: LoopOutcome["history"];
      iteration: number;
      lastReplyText: string;
    }): Promise<Decision>;
  };
  review?: (params: {
    reviewerAgentId?: string;
    reviewerModel?: string;
    task: string;
  }) => Promise<{
    rawText: string;
    issues: { severity: "info" | "warn" | "error"; file?: string; line?: number; message: string }[];
    verdict: "clean" | "issues" | "uncertain";
  }>;
  fix?: (params: {
    fixerAgentId?: string;
    fixerModel?: string;
    prompt: string;
  }) => Promise<{ runId: string; childSessionKey: string; summary: string }>;
};

export function createReplyDispatchHandler(deps: CreateReplyDispatchHandlerDeps) {
  return async function onReplyDispatch(
    event: ReplyDispatchEvent,
    ctx: ReplyDispatchContext,
  ): Promise<ReplyDispatchResult | undefined> {
    if (!deps.config.enabled) {
      return undefined;
    }

    const originalReply = event.ctx?.finalReply ?? { text: "" };
    const originalText = String(originalReply.text ?? "");
    const rollupKey = event.runId ?? event.sessionKey ?? "unknown-run";
    const parentSessionKey = event.sessionKey ?? event.ctx?.sessionKey;

    // Tracks whether sendFinalReply was invoked so error paths never double-send.
    let finalSent = false;
    const deliverFinal = (text: string): void => {
      if (finalSent) {
        return;
      }
      finalSent = true;
      const ok = ctx.dispatcher.sendFinalReply({ ...originalReply, text });
      if (!ok) {
        deps.runtime.logger.error("autoquality-claw: sendFinalReply reported delivery failure");
      }
      ctx.dispatcher.markComplete();
    };

    try {
      // Rule loading runs INSIDE the guarded region so a filesystem/parse
      // failure still lets us deliver the original reply to the user.
      let rules;
      try {
        const rulesRaw = await deps.runtime.readWorkspaceFile(deps.config.rulesPath);
        if (!rulesRaw || !rulesRaw.trim()) {
          deps.runtime.logger.warn(
            `autoquality-claw: rules file '${deps.config.rulesPath}' missing or empty — using defaults`,
          );
          rules = parseRules(null);
        } else {
          const parsed = parseRulesWithWarnings(rulesRaw);
          for (const warning of parsed.warnings) {
            deps.runtime.logger.warn(`autoquality-claw: rules: ${warning}`);
          }
          rules = parsed.rules;
        }
      } catch (error) {
        deps.runtime.logger.error(`autoquality-claw: failed reading rules file: ${String(error)}`);
        rules = parseRules(null);
      }

      const review =
        deps.review ??
        ((params: { reviewerAgentId?: string; reviewerModel?: string; task: string }) =>
          dispatchReview({
            runtime: { subagent: deps.runtime.subagent },
            parentSessionKey,
            reviewerAgentId: params.reviewerAgentId ?? deps.config.reviewerAgentId,
            reviewerModel: params.reviewerModel ?? deps.config.defaultReviewerModel,
            task: params.task,
            runTimeoutSeconds: deps.config.subagentRunTimeoutSeconds,
          }));
      const fix =
        deps.fix ??
        ((params: { fixerAgentId?: string; fixerModel?: string; prompt: string }) =>
          dispatchFix({
            runtime: { subagent: deps.runtime.subagent },
            parentSessionKey,
            fixerAgentId: params.fixerAgentId ?? deps.config.fixerAgentId,
            fixerModel: params.fixerModel ?? deps.config.defaultFixerModel,
            prompt: params.prompt,
            runTimeoutSeconds: deps.config.subagentRunTimeoutSeconds,
          }));
      const liveness = deps.config.emitLivenessUpdates
        ? (message: string): void => {
            const ok = ctx.dispatcher.sendBlockReply({ text: message });
            if (!ok) {
              deps.runtime.logger.warn(`autoquality-claw: liveness block reply dropped: ${message}`);
            }
          }
        : undefined;

      const outcome = await runAutoLoop({
        rules,
        rollupKey,
        lastReplyText: originalText,
        maxIterations: deps.config.maxIterations,
        loopTimeoutMs: deps.config.loopTimeoutSeconds * 1000,
        abortSignal: ctx.abortSignal,
        gatekeeper: deps.gatekeeper,
        review,
        fix,
        setIteration: deps.editsCollector.setIteration,
        getEdits: deps.editsCollector.getEdits,
        liveness,
      });
      const finalText = formatFinalMessage({ originalReply: originalText, outcome });

      deliverFinal(finalText);

      // Post-send bookkeeping: never let this throw past the guard.
      try {
        await ctx.dispatcher.waitForIdle();
      } catch (error) {
        deps.runtime.logger.warn(`autoquality-claw: waitForIdle failed: ${String(error)}`);
      }
      ctx.recordProcessed?.("completed");
      deps.editsCollector.clear(rollupKey);

      return {
        handled: true,
        queuedFinal: true,
        counts: ctx.dispatcher.getQueuedCounts(),
      };
    } catch (error) {
      deps.runtime.logger.error(`autoquality-claw reply_dispatch failed: ${String(error)}`);
      // Surface the failure to the user instead of silently serving the
      // pre-review reply — operators need to see when the gate broke.
      const failureSuffix = `\n\n— autoquality-claw failed: ${String(error)} —`;
      deliverFinal(originalText + failureSuffix);
      ctx.recordProcessed?.("error", { error: String(error) });
      deps.editsCollector.clear(rollupKey);

      return {
        handled: true,
        queuedFinal: true,
        counts: ctx.dispatcher.getQueuedCounts(),
      };
    }
  };
}
