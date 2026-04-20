import { describe, expect, it, vi } from "vitest";

import { dispatchReview } from "../src/dispatch-review.js";

describe("dispatchReview", () => {
  it("runs the reviewer subagent and parses the latest assistant summary", async () => {
    const run = vi.fn().mockResolvedValue({ runId: "rv1" });
    const waitForRun = vi.fn().mockResolvedValue({ status: "ok" });
    const getSessionMessages = vi.fn().mockResolvedValue({
      messages: [
        { role: "user", text: "review" },
        { role: "assistant", text: "Findings: error: /a.ts:10 - null deref" },
      ],
    });

    const output = await dispatchReview({
      runtime: { subagent: { run, waitForRun, getSessionMessages } },
      parentSessionKey: "ps",
      reviewerAgentId: "code-reviewer",
      reviewerModel: "claude-sonnet-4-6",
      task: "review",
      runTimeoutSeconds: 120,
    });

    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "review",
        model: "claude-sonnet-4-6",
        deliver: false,
      }),
    );
    expect(waitForRun).toHaveBeenCalledWith({ runId: "rv1", timeoutMs: 120_000 });
    const sessionKey = run.mock.calls[0]?.[0]?.sessionKey;
    expect(getSessionMessages).toHaveBeenCalledWith({ sessionKey, limit: 5 });
    expect(output.verdict).toBe("issues");
    expect(output.issues[0]).toMatchObject({ severity: "error", file: "/a.ts", line: 10 });
  });

  it("returns clean verdict when summary has no issues", async () => {
    const output = await dispatchReview({
      runtime: {
        subagent: {
          run: vi.fn().mockResolvedValue({ runId: "r" }),
          waitForRun: vi.fn().mockResolvedValue({ status: "ok" }),
          getSessionMessages: vi.fn().mockResolvedValue({
            messages: [{ role: "assistant", text: "Looks good." }],
          }),
        },
      },
      parentSessionKey: "ps",
      reviewerAgentId: "code-reviewer",
      reviewerModel: "x",
      task: "t",
      runTimeoutSeconds: 60,
    });

    expect(output.verdict).toBe("clean");
  });

  it("throws on subagent error", async () => {
    await expect(
      dispatchReview({
        runtime: {
          subagent: {
            run: vi.fn().mockResolvedValue({ runId: "r" }),
            waitForRun: vi.fn().mockResolvedValue({ status: "error", error: "boom" }),
            getSessionMessages: vi.fn(),
          },
        },
        parentSessionKey: "ps",
        reviewerAgentId: "r",
        reviewerModel: "m",
        task: "t",
        runTimeoutSeconds: 60,
      }),
    ).rejects.toThrow(/boom/);
  });
});
