import { describe, expect, it, vi } from "vitest";

import { dispatchFix } from "../src/dispatch-fix.js";

describe("dispatchFix", () => {
  it("runs the fixer subagent and returns its latest assistant summary", async () => {
    const run = vi.fn().mockResolvedValue({ runId: "fx" });
    const waitForRun = vi.fn().mockResolvedValue({ status: "ok" });
    const getSessionMessages = vi.fn().mockResolvedValue({
      messages: [{ role: "assistant", text: "Fixed 2 issues." }],
    });

    const output = await dispatchFix({
      runtime: { subagent: { run, waitForRun, getSessionMessages } },
      parentSessionKey: "ps",
      fixerAgentId: "coder",
      fixerModel: "claude-sonnet-4-6",
      prompt: "Fix the null deref",
      runTimeoutSeconds: 180,
    });

    expect(output.summary).toBe("Fixed 2 issues.");
    expect(output.runId).toBe("fx");
    expect(output.childSessionKey).toBe(run.mock.calls[0]?.[0]?.sessionKey);
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Fix the null deref",
        model: "claude-sonnet-4-6",
        deliver: false,
      }),
    );
    expect(waitForRun).toHaveBeenCalledWith({ runId: "fx", timeoutMs: 180_000 });
  });
});
