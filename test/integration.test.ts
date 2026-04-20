import { describe, expect, it, vi } from "vitest";

import { plugin } from "../src/plugin-entry.js";

type RegisteredHook = { name: string; handler: (...args: unknown[]) => unknown };

async function wire() {
  const registered: RegisteredHook[] = [];
  const runtime = {
    spawnSubagent: vi.fn().mockResolvedValue({
      status: "ok",
      runId: "child",
      childSessionKey: "cs",
      summary: "LGTM",
    }),
    readWorkspaceFile: vi
      .fn()
      .mockResolvedValue(
        "---\nminIterations: 1\nmaxIterations: 2\nqualityGate: lgtm\n---\n# rules\n\n## Reviewer instructions\nbe strict.",
      ),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    getConfigSection: <T>() => ({ anthropicApiKeyEnv: "NOPE" } as unknown as T),
  };

  process.env.NOPE = "test-key";

  await plugin.registerHooks(
    (registration) => {
      registered.push(registration);
    },
    runtime,
  );

  const byName = (name: string): RegisteredHook["handler"] => {
    const registration = registered.find((entry) => entry.name === name);
    if (!registration) {
      throw new Error(`missing registration: ${name}`);
    }

    return registration.handler;
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

    expect(runtime.spawnSubagent).not.toHaveBeenCalled();
  });
});
