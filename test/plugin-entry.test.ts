import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import pluginEntry from "../src/plugin-entry.js";

const makeApi = (on = vi.fn()) =>
  ({
    pluginConfig: {},
    config: {},
    logger: { debug() {}, info() {}, warn() {}, error() {} },
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
    on,
  }) as any;

describe("plugin-entry", () => {
  it("registers the expected hook names", () => {
    const registered: string[] = [];
    const on = vi.fn((hookName: string) => {
      registered.push(hookName);
    });

    pluginEntry.register(makeApi(on));

    expect(new Set(registered)).toEqual(
      new Set(["after_tool_call", "subagent_spawned", "subagent_ended", "reply_dispatch"]),
    );
  });

  it("registers reply_dispatch with elevated priority", () => {
    const on = vi.fn();

    pluginEntry.register(makeApi(on));

    expect(on).toHaveBeenCalledWith("reply_dispatch", expect.any(Function), { priority: 100 });
  });

  it("has a matching id", () => {
    expect(pluginEntry.id).toBe("autoquality-claw");
  });
});
