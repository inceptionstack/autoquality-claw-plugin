import type { AutoClawConfig } from "./config.js";
import { dispatchFix } from "./dispatch-fix.js";
import { dispatchReview } from "./dispatch-review.js";
import { formatFinalMessage } from "./format-output.js";
import { runAutoLoop } from "./loop.js";
import type { PluginRuntime } from "./runtime-api.js";
import { parseRules } from "./rules.js";
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
  ctx?: {
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
  runtime: PluginRuntime;
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
    const workspaceDir = event.ctx?.workspaceDir;

    const rulesRaw = await deps.runtime.readWorkspaceFile(deps.config.rulesPath, { workspaceDir });
    const rules = parseRules(rulesRaw);
    const review =
      deps.review ??
      ((params: { reviewerAgentId?: string; reviewerModel?: string; task: string }) =>
        dispatchReview({
          runtime: deps.runtime,
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
          runtime: deps.runtime,
          parentSessionKey,
          fixerAgentId: params.fixerAgentId ?? deps.config.fixerAgentId,
          fixerModel: params.fixerModel ?? deps.config.defaultFixerModel,
          prompt: params.prompt,
          runTimeoutSeconds: deps.config.subagentRunTimeoutSeconds,
        }));
    const liveness = deps.config.emitLivenessUpdates
      ? (message: string): void => {
          ctx.dispatcher.sendBlockReply({ text: message });
        }
      : undefined;

    try {
      const outcome = await runAutoLoop({
        rules,
        rollupKey,
        parentSessionKey,
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

      ctx.dispatcher.sendFinalReply({ ...originalReply, text: finalText });
      ctx.dispatcher.markComplete();
      await ctx.dispatcher.waitForIdle();
      ctx.recordProcessed?.("completed");
      deps.editsCollector.clear(rollupKey);

      return {
        handled: true,
        queuedFinal: true,
        counts: ctx.dispatcher.getQueuedCounts(),
      };
    } catch (error) {
      deps.runtime.logger.error(`auto-claw reply_dispatch failed: ${String(error)}`);
      ctx.dispatcher.sendFinalReply({ ...originalReply, text: originalText });
      ctx.dispatcher.markComplete();
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
