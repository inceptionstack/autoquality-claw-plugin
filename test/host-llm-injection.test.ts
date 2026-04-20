import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import pluginEntry from "../src/plugin-entry.js";
import type { GatekeeperLlmLike } from "../src/runtime-api.js";

describe("plugin inherits host-provided LLM client", () => {
  it("uses pluginConfig.gatekeeperLlm instead of building its own Anthropic client", async () => {
    const hostDecide = vi.fn(async () => ({ action: "approve" }));
    const hostLlm: GatekeeperLlmLike = { decide: hostDecide };

    const hooks = new Map<string, Function>();
    pluginEntry.register({
      pluginConfig: { enabled: true, gatekeeperLlm: hostLlm },
      config: {},
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      runtime: {
        agent: {
          resolveAgentWorkspaceDir: vi.fn(() => resolve(import.meta.dirname, "..", "examples")),
        },
        subagent: {
          run: vi.fn(),
          waitForRun: vi.fn(),
          getSessionMessages: vi.fn(),
        },
      },
      on: vi.fn((hookName: string, handler: Function) => {
        hooks.set(hookName, handler);
      }),
    } as any);

    const replyHook = hooks.get("reply_dispatch");
    expect(replyHook).toBeDefined();

    const dispatcher = {
      sendToolResult: vi.fn(() => true),
      sendBlockReply: vi.fn(() => true),
      sendFinalReply: vi.fn(() => true),
      waitForIdle: vi.fn(async () => undefined),
      getQueuedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 1 })),
      getFailedCounts: vi.fn(() => ({ tool: 0, block: 0, final: 0 })),
      markComplete: vi.fn(),
    };

    await replyHook!(
      {
        ctx: { finalReply: { text: "hello" }, sessionKey: "s" },
        runId: "r",
        sessionKey: "s",
        inboundAudio: false,
        shouldRouteToOriginating: false,
        shouldSendToolSummaries: false,
        sendPolicy: "allow",
      },
      { cfg: {}, dispatcher, recordProcessed: vi.fn(), markIdle: vi.fn() },
    );

    expect(hostDecide).toHaveBeenCalledTimes(1);
  });
});
