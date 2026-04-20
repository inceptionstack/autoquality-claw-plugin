import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import pluginEntry from "../src/plugin-entry.js";

type RegisteredHook = (...args: unknown[]) => unknown;

async function wire() {
  const hooks = new Map<string, RegisteredHook>();
  const runtime = {
    agent: {
      resolveAgentWorkspaceDir: vi.fn(() => resolve(import.meta.dirname, "..", "examples")),
    },
    subagent: {
      run: vi.fn().mockResolvedValue({ runId: "child" }),
      waitForRun: vi.fn().mockResolvedValue({ status: "ok" }),
      getSessionMessages: vi.fn().mockResolvedValue({
        messages: [{ role: "assistant", text: "LGTM" }],
      }),
    },
  };

  process.env.NOPE = "test-key";

  pluginEntry.register({
    pluginConfig: { anthropicApiKeyEnv: "NOPE" },
    config: {},
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    runtime,
    on: vi.fn((hookName: string, handler: RegisteredHook) => {
      hooks.set(hookName, handler);
    }),
  } as any);

  const byName = (name: string): RegisteredHook => {
    const registration = hooks.get(name);
    if (!registration) {
      throw new Error(`missing registration: ${name}`);
    }

    return registration;
  };

  return { runtime, byName };
}

describe("autoquality-claw end-to-end (mocked gatekeeper)", () => {
  it("runs the wiring hooks without invoking reply dispatch", async () => {
    const { byName, runtime } = await wire();
    const afterTool = byName("after_tool_call");

    await afterTool(
      { toolName: "edit", params: { file_path: "/work/a.ts" } },
      { runId: "root", toolName: "edit" },
    );

    const spawned = byName("subagent_spawned");
    await spawned(
      { runId: "child", childSessionKey: "cs", agentId: "coder", mode: "run", threadRequested: false },
      { requesterSessionKey: "root" },
    );
    await afterTool(
      { toolName: "edit", params: { file_path: "/work/b.ts" } },
      { runId: "child", toolName: "edit" },
    );

    const ended = byName("subagent_ended");
    await ended({ targetSessionKey: "cs", targetKind: "subagent", reason: "done" });

    expect(runtime.subagent.run).not.toHaveBeenCalled();
  });
});
