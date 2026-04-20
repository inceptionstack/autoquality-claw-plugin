import { describe, expect, it, vi } from "vitest";

import type { AutoClawConfig } from "../src/config.js";
import { createReplyDispatchHandler } from "../src/reply-dispatch.js";

function makeDispatcher(opts: { sendFinalFails?: boolean; waitForIdleThrows?: boolean } = {}) {
  const calls: { method: string; arg: unknown }[] = [];

  return {
    dispatcher: {
      sendToolResult: vi.fn((payload: unknown) => {
        calls.push({ method: "tool", arg: payload });
        return true;
      }),
      sendBlockReply: vi.fn((payload: unknown) => {
        calls.push({ method: "block", arg: payload });
        return true;
      }),
      sendFinalReply: vi.fn((payload: unknown) => {
        calls.push({ method: "final", arg: payload });
        return !opts.sendFinalFails;
      }),
      waitForIdle: vi.fn(async () => {
        if (opts.waitForIdleThrows) {
          throw new Error("idle blew up");
        }
      }),
      getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 1 })),
      getFailedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
      markComplete: vi.fn(),
    },
    calls,
  };
}

const enabledConfig: AutoClawConfig = {
  enabled: true,
  rulesPath: "review-rules.md",
  anthropicApiKeyEnv: "K",
  gatekeeperModel: "g",
  defaultReviewerModel: "r",
  defaultFixerModel: "f",
  reviewerAgentId: "rv",
  fixerAgentId: "fx",
  maxIterations: 3,
  loopTimeoutSeconds: 60,
  subagentRunTimeoutSeconds: 60,
  emitLivenessUpdates: false,
  mutatingTools: ["edit"],
};

const loggerStub = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

describe("reply_dispatch hardening", () => {
  it("delivers original reply with failure suffix when readWorkspaceFile throws", async () => {
    const { dispatcher, calls } = makeDispatcher();
    const logger = loggerStub();
    const handler = createReplyDispatchHandler({
      config: enabledConfig,
      runtime: {
        spawnSubagent: vi.fn(),
        readWorkspaceFile: vi.fn(async () => {
          throw new Error("fs blew up");
        }),
        logger,
        getConfigSection: () => undefined,
      },
      editsCollector: {
        getEdits: () => [],
        clear: vi.fn(),
        setIteration: vi.fn(),
        onAfterToolCall: vi.fn(),
        snapshot: () => new Map(),
      },
      // Loop still runs — gatekeeper approves so final delivery succeeds.
      gatekeeper: { decide: vi.fn().mockResolvedValue({ action: "approve" }) },
      review: vi.fn(),
      fix: vi.fn(),
    });

    const result = await handler(
      {
        ctx: { finalReply: { text: "hello" }, sessionKey: "ps" },
        runId: "root",
        sessionKey: "ps",
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: false,
        sendPolicy: "allow",
      },
      { cfg: {}, dispatcher, recordProcessed: vi.fn(), markIdle: vi.fn() },
    );

    expect(result?.handled).toBe(true);
    // Error was logged.
    expect(logger.error).toHaveBeenCalled();
    // Exactly one final reply was sent.
    const finalCalls = calls.filter((c) => c.method === "final");
    expect(finalCalls).toHaveLength(1);
  });

  it("never calls sendFinalReply more than once even when post-send throws", async () => {
    const { dispatcher, calls } = makeDispatcher({ waitForIdleThrows: true });
    const logger = loggerStub();
    const handler = createReplyDispatchHandler({
      config: enabledConfig,
      runtime: {
        spawnSubagent: vi.fn(),
        readWorkspaceFile: vi.fn(async () => "# rules"),
        logger,
        getConfigSection: () => undefined,
      },
      editsCollector: {
        getEdits: () => [],
        clear: vi.fn(),
        setIteration: vi.fn(),
        onAfterToolCall: vi.fn(),
        snapshot: () => new Map(),
      },
      gatekeeper: { decide: vi.fn().mockResolvedValue({ action: "approve" }) },
      review: vi.fn(),
      fix: vi.fn(),
    });

    await handler(
      {
        ctx: { finalReply: { text: "x" }, sessionKey: "ps" },
        runId: "r",
        sessionKey: "ps",
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: false,
        sendPolicy: "allow",
      },
      { cfg: {}, dispatcher, recordProcessed: vi.fn(), markIdle: vi.fn() },
    );

    expect(calls.filter((c) => c.method === "final")).toHaveLength(1);
    // waitForIdle threw but we logged it instead of crashing the outer guard.
    expect(logger.warn).toHaveBeenCalled();
  });

  it("delivers an error-suffixed original reply when the loop throws", async () => {
    const { dispatcher, calls } = makeDispatcher();
    const logger = loggerStub();
    const handler = createReplyDispatchHandler({
      config: enabledConfig,
      runtime: {
        spawnSubagent: vi.fn(),
        readWorkspaceFile: vi.fn(async () => "# rules"),
        logger,
        getConfigSection: () => undefined,
      },
      editsCollector: {
        // This throws from inside the loop to simulate catastrophic failure.
        getEdits: vi.fn(() => {
          throw new Error("snapshot exploded");
        }) as never,
        clear: vi.fn(),
        setIteration: vi.fn(),
        onAfterToolCall: vi.fn(),
        snapshot: () => new Map(),
      },
      gatekeeper: { decide: vi.fn().mockResolvedValue({ action: "approve" }) },
      review: vi.fn(),
      fix: vi.fn(),
    });

    const result = await handler(
      {
        ctx: { finalReply: { text: "hello" }, sessionKey: "ps" },
        runId: "r",
        sessionKey: "ps",
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: false,
        sendPolicy: "allow",
      },
      { cfg: {}, dispatcher, recordProcessed: vi.fn(), markIdle: vi.fn() },
    );

    expect(result?.handled).toBe(true);
    const finalText = (calls.find((c) => c.method === "final")?.arg as { text?: string } | undefined)?.text ?? "";
    expect(finalText).toContain("hello");
    expect(finalText).toContain("autoquality-claw failed");
    expect(logger.error).toHaveBeenCalled();
  });
});
