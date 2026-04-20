import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RULES } from "../src/rules.js";
import { runAutoLoop } from "../src/loop.js";
import type { Decision } from "../src/types.js";

function makeDeps(decisions: Decision[], reviewVerdicts: ("clean" | "issues")[] = []) {
  let decisionIndex = 0;
  let reviewIndex = 0;

  return {
    gatekeeper: {
      decide: vi.fn(async () => decisions[decisionIndex++] ?? { action: "stop", reason: "no more" }),
    },
    review: vi.fn(async () => ({
      rawText: "rv",
      issues: reviewVerdicts[reviewIndex] === "issues" ? [{ severity: "error", message: "m" } as const] : [],
      verdict: (reviewVerdicts[reviewIndex++] ?? "clean") as "clean" | "issues",
    })),
    fix: vi.fn(async () => ({ runId: "fx", childSessionKey: "s", summary: "applied fix" })),
    setIteration: vi.fn(),
    getEdits: vi.fn(() => []),
    liveness: vi.fn(),
  };
}

describe("runAutoLoop", () => {
  it("approves on first decision and stops", async () => {
    const deps = makeDeps([{ action: "approve" }]);

    const output = await runAutoLoop({
      rules: DEFAULT_RULES,
      rollupKey: "root",
      parentSessionKey: "ps",
      lastReplyText: "x",
      maxIterations: 5,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("approved");
    expect(output.iterations).toBe(1);
    expect(deps.review).not.toHaveBeenCalled();
    expect(deps.fix).not.toHaveBeenCalled();
  });

  it("runs a review and then approves", async () => {
    const deps = makeDeps([{ action: "review" }, { action: "approve" }], ["clean"]);

    const output = await runAutoLoop({
      rules: DEFAULT_RULES,
      rollupKey: "root",
      parentSessionKey: "ps",
      lastReplyText: "x",
      maxIterations: 5,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("approved");
    expect(deps.review).toHaveBeenCalledTimes(1);
    expect(deps.fix).not.toHaveBeenCalled();
  });

  it("runs review -> fix -> review -> approve", async () => {
    const deps = makeDeps(
      [{ action: "review" }, { action: "fix", fixerPrompt: "fix" }, { action: "review" }, { action: "approve" }],
      ["issues", "clean"],
    );

    const output = await runAutoLoop({
      rules: DEFAULT_RULES,
      rollupKey: "root",
      parentSessionKey: "ps",
      lastReplyText: "x",
      maxIterations: 5,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("approved");
    expect(deps.review).toHaveBeenCalledTimes(2);
    expect(deps.fix).toHaveBeenCalledTimes(1);
    expect(output.iterations).toBe(4);
  });

  it("hits max-iterations and returns that status", async () => {
    const decisions: Decision[] = [
      { action: "review" },
      { action: "fix", fixerPrompt: "f" },
      { action: "review" },
    ];
    const deps = makeDeps(decisions, ["issues", "issues"]);

    const output = await runAutoLoop({
      rules: DEFAULT_RULES,
      rollupKey: "root",
      parentSessionKey: "ps",
      lastReplyText: "x",
      maxIterations: 3,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("max-iterations");
  });

  it("aborts when the signal fires", async () => {
    const controller = new AbortController();
    const deps = makeDeps([{ action: "review" }], ["clean"]);

    deps.review = vi.fn(async () => {
      controller.abort();
      return { rawText: "", issues: [], verdict: "clean" as const };
    });

    const output = await runAutoLoop({
      rules: DEFAULT_RULES,
      rollupKey: "root",
      parentSessionKey: "ps",
      lastReplyText: "x",
      maxIterations: 5,
      loopTimeoutMs: 10_000,
      abortSignal: controller.signal,
      ...deps,
    });

    expect(output.status).toBe("aborted");
  });
});
