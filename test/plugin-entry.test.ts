import { describe, expect, it, vi } from "vitest";

import { plugin } from "../src/plugin-entry.js";

describe("plugin-entry", () => {
  it("registers the expected hook names", async () => {
    const registered: string[] = [];
    const register = vi.fn((registration: { name: string }) => {
      registered.push(registration.name);
    });
    const runtime = {
      spawnSubagent: vi.fn(),
      readWorkspaceFile: vi.fn(async () => ""),
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      getConfigSection: () => ({}),
    };

    await plugin.registerHooks(
      register as Parameters<typeof plugin.registerHooks>[0],
      runtime as Parameters<typeof plugin.registerHooks>[1],
    );

    expect(new Set(registered)).toEqual(
      new Set(["after_tool_call", "subagent_spawned", "subagent_ended", "reply_dispatch"]),
    );
  });

  it("has a matching id", () => {
    expect(plugin.id).toBe("auto-claw");
  });
});
