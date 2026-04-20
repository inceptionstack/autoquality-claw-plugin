import { describe, expect, it, vi } from "vitest";

import { createGatekeeper } from "../src/gatekeeper.js";
import { DEFAULT_RULES } from "../src/rules.js";

describe("Gatekeeper.decide", () => {
  it("returns an approve decision when llm says approve", async () => {
    const llm = { decide: vi.fn().mockResolvedValue({ action: "approve", note: "ok" }) };
    const gatekeeper = createGatekeeper({ llm });

    const decision = await gatekeeper.decide({
      rules: DEFAULT_RULES,
      edits: [],
      history: [],
      iteration: 1,
      lastReplyText: "done",
    });

    expect(decision.action).toBe("approve");
  });

  it("returns a fix decision with required fields", async () => {
    const llm = {
      decide: vi.fn().mockResolvedValue({
        action: "fix",
        fixerPrompt: "fix the null deref on line 12",
        fixerModel: "claude-sonnet-4-6",
      }),
    };
    const gatekeeper = createGatekeeper({ llm });

    const decision = await gatekeeper.decide({
      rules: DEFAULT_RULES,
      edits: [],
      history: [],
      iteration: 2,
      lastReplyText: "done",
    });

    expect(decision).toMatchObject({
      action: "fix",
      fixerPrompt: "fix the null deref on line 12",
    });
  });

  it("falls back to stop when llm returns an invalid action", async () => {
    const llm = { decide: vi.fn().mockResolvedValue({ action: "weird" }) };
    const gatekeeper = createGatekeeper({ llm });

    const decision = await gatekeeper.decide({
      rules: DEFAULT_RULES,
      edits: [],
      history: [],
      iteration: 1,
      lastReplyText: "x",
    });

    expect(decision.action).toBe("stop");
  });

  it("forces stop when iteration >= rules.maxIterations", async () => {
    const llm = { decide: vi.fn().mockResolvedValue({ action: "fix", fixerPrompt: "x" }) };
    const gatekeeper = createGatekeeper({ llm });

    const decision = await gatekeeper.decide({
      rules: { ...DEFAULT_RULES, maxIterations: 2 },
      edits: [],
      history: [],
      iteration: 2,
      lastReplyText: "x",
    });

    expect(decision.action).toBe("stop");
    expect(llm.decide).not.toHaveBeenCalled();
  });
});
