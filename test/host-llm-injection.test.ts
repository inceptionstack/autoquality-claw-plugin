import { describe, expect, it, vi } from "vitest";

import { plugin } from "../src/plugin-entry.js";
import type {
  PluginHookRegistration,
  PluginRuntime,
  GatekeeperLlmLike,
} from "../src/runtime-api.js";

/**
 * Red test: if the host OpenClaw provides its own configured LLM via
 * runtime.getGatekeeperLlm?.() (e.g. a Bedrock / Mantle / OpenAI client
 * already wired up to the chosen provider), auto-claw MUST use it instead
 * of constructing a new Anthropic SDK client from ANTHROPIC_API_KEY.
 *
 * Behavior under test:
 *   1. plugin.registerHooks is called with a runtime that exposes
 *      getGatekeeperLlm() → returns a custom decide() function.
 *   2. When reply_dispatch fires, the gatekeeper invokes that host-provided
 *      decide(), not the built-in Anthropic-SDK one.
 *
 * Why this is a bug today: plugin-entry unconditionally calls
 * createGatekeeperLlm() which news up `new Anthropic({apiKey: ...})`.
 * Consumers running on Bedrock/Mantle/OpenAI can't use the plugin.
 */

describe("plugin inherits host-provided LLM client", () => {
  it("uses runtime.getGatekeeperLlm() instead of building its own Anthropic client", async () => {
    const hostDecide = vi.fn(async () => ({ action: "approve" }));
    const hostLlm: GatekeeperLlmLike = { decide: hostDecide };

    const registered: PluginHookRegistration[] = [];
    const runtime: PluginRuntime = {
      spawnSubagent: vi.fn() as unknown as PluginRuntime["spawnSubagent"],
      readWorkspaceFile: vi.fn(async () => "# rules"),
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      getConfigSection: () => ({ enabled: true }) as never,
      getGatekeeperLlm: () => hostLlm,
    };

    // Ensure no ANTHROPIC_API_KEY is set so any fallback to the real SDK
    // would fail loudly instead of silently.
    const prior = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await plugin.registerHooks((reg) => registered.push(reg), runtime);

      const replyHook = registered.find((r) => r.name === "reply_dispatch");
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

      await replyHook!.handler(
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
    } finally {
      if (prior !== undefined) {
        process.env.ANTHROPIC_API_KEY = prior;
      }
    }
  });
});
