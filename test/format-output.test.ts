import { describe, expect, it } from "vitest";

import { formatFinalMessage } from "../src/format-output.js";

describe("formatFinalMessage", () => {
  it("returns just the original reply when approved with no review activity", () => {
    const output = formatFinalMessage({
      originalReply: "done.",
      outcome: {
        status: "approved",
        history: [{ kind: "decision", iteration: 1, decision: { action: "approve" } }],
        iterations: 1,
      },
    });

    expect(output).toBe("done.");
  });

  it("appends a review summary when reviews happened", () => {
    const output = formatFinalMessage({
      originalReply: "done.",
      outcome: {
        status: "approved",
        iterations: 3,
        history: [
          { kind: "decision", iteration: 1, decision: { action: "review" } },
          { kind: "review", iteration: 1, result: { rawText: "LGTM", issues: [], verdict: "clean" } },
          { kind: "decision", iteration: 2, decision: { action: "approve" } },
        ],
      },
    });

    expect(output).toContain("done.");
    expect(output).toContain("auto-claw");
    expect(output).toContain("iterations: 3");
    expect(output).toContain("LGTM");
  });

  it("flags max-iterations status", () => {
    const output = formatFinalMessage({
      originalReply: "done.",
      outcome: { status: "max-iterations", iterations: 4, history: [] },
    });

    expect(output).toMatch(/max iterations/i);
  });
});
