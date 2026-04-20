import { describe, expect, it, vi } from "vitest";

import type { SpawnSubagentFn } from "../src/runtime-api.js";
import { dispatchReview } from "../src/dispatch-review.js";

describe("dispatchReview", () => {
  it("calls spawnSubagent with the configured reviewer agentId and model", async () => {
    const spawn = vi.fn<SpawnSubagentFn>().mockResolvedValue({
      status: "ok",
      runId: "rv1",
      childSessionKey: "rvs1",
      summary: "Findings: error: /a.ts:10 - null deref",
    });

    const output = await dispatchReview({
      runtime: { spawnSubagent: spawn },
      parentSessionKey: "ps",
      reviewerAgentId: "code-reviewer",
      reviewerModel: "claude-sonnet-4-6",
      task: "review",
      runTimeoutSeconds: 120,
    });

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "code-reviewer",
        model: "claude-sonnet-4-6",
        mode: "run",
        thread: false,
        task: "review",
        runTimeoutSeconds: 120,
      }),
      { agentSessionKey: "ps" },
    );
    expect(output.verdict).toBe("issues");
    expect(output.issues[0]).toMatchObject({ severity: "error", file: "/a.ts", line: 10 });
  });

  it("returns clean verdict when summary has no issues", async () => {
    const spawn = vi.fn<SpawnSubagentFn>().mockResolvedValue({
      status: "ok",
      runId: "r",
      childSessionKey: "s",
      summary: "Looks good.",
    });

    const output = await dispatchReview({
      runtime: { spawnSubagent: spawn },
      parentSessionKey: "ps",
      reviewerAgentId: "code-reviewer",
      reviewerModel: "x",
      task: "t",
      runTimeoutSeconds: 60,
    });

    expect(output.verdict).toBe("clean");
  });

  it("throws on spawn error", async () => {
    const spawn = vi.fn<SpawnSubagentFn>().mockResolvedValue({ status: "error", error: "boom" });

    await expect(
      dispatchReview({
        runtime: { spawnSubagent: spawn },
        parentSessionKey: "ps",
        reviewerAgentId: "r",
        reviewerModel: "m",
        task: "t",
        runTimeoutSeconds: 60,
      }),
    ).rejects.toThrow(/boom/);
  });
});
