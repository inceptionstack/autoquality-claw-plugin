import { describe, expect, it, vi } from "vitest";

import type { AutoClawConfig } from "../src/config.js";
import { createReplyDispatchHandler } from "../src/reply-dispatch.js";

function makeDispatcher() {
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
        return true;
      }),
      waitForIdle: vi.fn(async () => {}),
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

describe("reply_dispatch handler", () => {
  it("delivers the original reply and returns handled=true when loop approves", async () => {
    const { dispatcher, calls } = makeDispatcher();
    const handler = createReplyDispatchHandler({
      config: enabledConfig,
      runtime: {
        spawnSubagent: vi.fn(),
        readWorkspaceFile: vi.fn(async () => "---\n---\n# rules"),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
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

    const result = await handler(
      {
        ctx: { finalReply: { text: "hello user" }, sessionKey: "ps" },
        runId: "root",
        sessionKey: "ps",
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: false,
        sendPolicy: "allow",
      },
      {
        cfg: {},
        dispatcher,
        recordProcessed: vi.fn(),
        markIdle: vi.fn(),
      },
    );

    expect(result).toEqual(expect.objectContaining({ handled: true, queuedFinal: true }));
    expect((calls.find((call) => call.method === "final")?.arg as { text?: string } | undefined)?.text).toBe("hello user");
    expect(dispatcher.markComplete).toHaveBeenCalled();
  });

  it("skips the loop and returns undefined when disabled", async () => {
    const { dispatcher } = makeDispatcher();
    const handler = createReplyDispatchHandler({
      config: { ...enabledConfig, enabled: false },
      runtime: {
        spawnSubagent: vi.fn(),
        readWorkspaceFile: vi.fn(),
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        getConfigSection: () => undefined,
      },
      editsCollector: {
        getEdits: () => [],
        clear: vi.fn(),
        setIteration: vi.fn(),
        onAfterToolCall: vi.fn(),
        snapshot: () => new Map(),
      },
      gatekeeper: { decide: vi.fn() },
      review: vi.fn(),
      fix: vi.fn(),
    });

    const result = await handler(
      {} as Parameters<ReturnType<typeof createReplyDispatchHandler>>[0],
      { dispatcher } as Parameters<ReturnType<typeof createReplyDispatchHandler>>[1],
    );

    expect(result).toBeUndefined();
    expect(dispatcher.sendFinalReply).not.toHaveBeenCalled();
  });
});
