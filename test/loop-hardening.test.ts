import { describe, expect, it, vi } from "vitest";

import { DEFAULT_RULES, parseRules, parseRulesWithWarnings } from "../src/rules.js";
import { runAutoLoop } from "../src/loop.js";
import type { Decision } from "../src/types.js";

describe("rules.ts frontmatter validation", () => {
  it("rejects NaN maxIterations and falls back to default with a warning", () => {
    const { rules, warnings } = parseRulesWithWarnings(
      `---\nmaxIterations: oops\n---\n## Reviewer instructions\nreview`,
    );

    expect(rules.maxIterations).toBe(DEFAULT_RULES.maxIterations);
    expect(warnings.some((w) => w.includes("invalid maxIterations"))).toBe(true);
  });

  it("rejects negative minIterations", () => {
    const { rules, warnings } = parseRulesWithWarnings(`---\nminIterations: -1\n---`);

    expect(rules.minIterations).toBe(DEFAULT_RULES.minIterations);
    expect(warnings.some((w) => w.includes("invalid minIterations"))).toBe(true);
  });

  it("rejects inverted min>max range", () => {
    const { rules, warnings } = parseRulesWithWarnings(
      `---\nminIterations: 5\nmaxIterations: 2\n---`,
    );

    expect(rules.minIterations).toBe(DEFAULT_RULES.minIterations);
    expect(rules.maxIterations).toBe(DEFAULT_RULES.maxIterations);
    expect(warnings.some((w) => w.includes("minIterations"))).toBe(true);
  });

  it("maxIterations=0 is rejected (must be >= 1)", () => {
    const { rules } = parseRulesWithWarnings(`---\nmaxIterations: 0\n---`);
    expect(rules.maxIterations).toBe(DEFAULT_RULES.maxIterations);
  });
});

describe("runAutoLoop — hardened behaviors", () => {
  function makeDeps(decisions: Decision[], reviewVerdicts: ("clean" | "issues")[] = [], editCountSeq: number[] = []) {
    let decisionIndex = 0;
    let reviewIndex = 0;
    let editIndex = 0;

    return {
      gatekeeper: {
        decide: vi.fn(async () => decisions[decisionIndex++] ?? { action: "stop", reason: "no more" }),
      },
      review: vi.fn(async () => ({
        rawText: "rv",
        issues: [],
        verdict: (reviewVerdicts[reviewIndex++] ?? "clean") as "clean" | "issues",
      })),
      fix: vi.fn(async () => ({ runId: "fx", childSessionKey: "s", summary: "applied fix" })),
      setIteration: vi.fn(),
      getEdits: vi.fn(() => {
        const count = editCountSeq[editIndex] ?? editCountSeq[editCountSeq.length - 1] ?? 0;
        editIndex += 1;
        return Array.from({ length: count }, () => ({
          rollupKey: "root",
          runId: "r",
          tool: "edit" as const,
          params: {},
          at: 0,
          iteration: 0,
        }));
      }),
      liveness: vi.fn(),
    };
  }

  it("effectiveMax is min(config.maxIterations, rules.maxIterations)", async () => {
    const deps = makeDeps([
      { action: "review" }, { action: "review" }, { action: "review" }, { action: "review" }, { action: "review" },
    ]);

    const output = await runAutoLoop({
      rules: { ...DEFAULT_RULES, maxIterations: 2 },
      rollupKey: "root",
      lastReplyText: "x",
      maxIterations: 20,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("max-iterations");
    expect(output.iterations).toBe(2);
  });

  it("stops after two consecutive zero-edit fixes (no-progress)", async () => {
    // getEdits always returns 1 (pre-existing edit), so editCount delta is 0.
    const deps = makeDeps(
      [
        { action: "fix", fixerPrompt: "try" },
        { action: "fix", fixerPrompt: "try again" },
        { action: "approve" }, // should never be reached
      ],
      [],
      [1, 1, 1, 1, 1, 1],
    );

    const output = await runAutoLoop({
      rules: { ...DEFAULT_RULES, maxIterations: 10 },
      rollupKey: "root",
      lastReplyText: "x",
      maxIterations: 10,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("stopped");
    expect(output.history.some((h) => h.kind === "error" && h.error.includes("no-progress"))).toBe(true);
    expect(deps.fix).toHaveBeenCalledTimes(2);
  });

  it("enforces minIterations only when there are edits", async () => {
    // No edits: approve on first pass regardless of minIterations.
    const deps = makeDeps([{ action: "approve" }]);

    const output = await runAutoLoop({
      rules: { ...DEFAULT_RULES, minIterations: 3, maxIterations: 10 },
      rollupKey: "root",
      lastReplyText: "x",
      maxIterations: 10,
      loopTimeoutMs: 10_000,
      ...deps,
    });

    expect(output.status).toBe("approved");
    expect(output.iterations).toBe(1);
  });

  it("mid-await timeout returns timeout, not error", async () => {
    const deps = {
      gatekeeper: {
        decide: vi.fn((): Promise<Decision> => new Promise(() => { /* never resolves */ })),
      },
      review: vi.fn(),
      fix: vi.fn(),
      setIteration: vi.fn(),
      getEdits: vi.fn(() => []),
      liveness: vi.fn(),
    };

    const output = await runAutoLoop({
      rules: { ...DEFAULT_RULES, maxIterations: 5 },
      rollupKey: "root",
      lastReplyText: "x",
      maxIterations: 5,
      loopTimeoutMs: 25,
      ...deps,
    });

    expect(output.status).toBe("timeout");
  });

  it("mid-await abort returns aborted, not error", async () => {
    const controller = new AbortController();
    const deps = {
      gatekeeper: {
        decide: vi.fn((): Promise<Decision> => new Promise(() => { /* never resolves */ })),
      },
      review: vi.fn(),
      fix: vi.fn(),
      setIteration: vi.fn(),
      getEdits: vi.fn(() => []),
      liveness: vi.fn(),
    };

    const promise = runAutoLoop({
      rules: { ...DEFAULT_RULES, maxIterations: 5 },
      rollupKey: "root",
      lastReplyText: "x",
      maxIterations: 5,
      loopTimeoutMs: 10_000,
      abortSignal: controller.signal,
      ...deps,
    });

    // Abort after microtask tick to ensure we're awaiting the gatekeeper.
    setTimeout(() => controller.abort(), 10);

    const output = await promise;
    expect(output.status).toBe("aborted");
  });
});
