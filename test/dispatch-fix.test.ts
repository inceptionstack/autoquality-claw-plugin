import { describe, expect, it, vi } from "vitest";

import type { SpawnSubagentFn } from "../src/runtime-api.js";
import { dispatchFix } from "../src/dispatch-fix.js";

describe("dispatchFix", () => {
  it("spawns the fixer subagent and returns its summary", async () => {
    const spawn = vi.fn<SpawnSubagentFn>().mockResolvedValue({
      status: "ok",
      runId: "fx",
      childSessionKey: "fxs",
      summary: "Fixed 2 issues.",
    });

    const output = await dispatchFix({
      runtime: { spawnSubagent: spawn },
      parentSessionKey: "ps",
      fixerAgentId: "coder",
      fixerModel: "claude-sonnet-4-6",
      prompt: "Fix the null deref",
      runTimeoutSeconds: 180,
    });

    expect(output.summary).toBe("Fixed 2 issues.");
    expect(output.runId).toBe("fx");
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "coder",
        task: "Fix the null deref",
        mode: "run",
        sandbox: "inherit",
      }),
      { agentSessionKey: "ps" },
    );
  });
});
