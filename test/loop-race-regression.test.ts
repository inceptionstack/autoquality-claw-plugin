import { describe, expect, it, vi } from "vitest";

import { runAutoLoop } from "../src/loop.js";
import { DEFAULT_RULES } from "../src/rules.js";
import type { Decision } from "../src/types.js";

/**
 * Regression: when timeout/abort wins the race in `raceAwait`, a late
 * rejection from the awaited work used to escape as an unhandledRejection
 * because the promise was never observed.
 *
 * This test proves the bug by installing a listener and asserting no
 * unhandled rejections fire during / shortly after the loop completes.
 */
describe("loop raceAwait — late rejection handling", () => {
  it("does not emit an unhandledRejection when the awaited promise rejects after timeout", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      // Gatekeeper promise rejects *after* we've already timed out.
      const lateReject = new Promise<Decision>((_, reject) =>
        setTimeout(() => reject(new Error("late boom")), 40),
      );

      const output = await runAutoLoop({
        rules: { ...DEFAULT_RULES, maxIterations: 5 },
        rollupKey: "root",
        lastReplyText: "x",
        maxIterations: 5,
        loopTimeoutMs: 5,
        gatekeeper: { decide: vi.fn().mockReturnValue(lateReject) },
        review: vi.fn(),
        fix: vi.fn(),
        setIteration: vi.fn(),
        getEdits: vi.fn(() => []),
        liveness: vi.fn(),
      });

      expect(output.status).toBe("timeout");

      // Give the late rejection time to settle so any unhandledRejection
      // event would have fired by now.
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("does not emit an unhandledRejection when the awaited promise rejects after abort", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const controller = new AbortController();
      const lateReject = new Promise<Decision>((_, reject) =>
        setTimeout(() => reject(new Error("late abort boom")), 40),
      );

      const promise = runAutoLoop({
        rules: { ...DEFAULT_RULES, maxIterations: 5 },
        rollupKey: "root",
        lastReplyText: "x",
        maxIterations: 5,
        loopTimeoutMs: 10_000,
        abortSignal: controller.signal,
        gatekeeper: { decide: vi.fn().mockReturnValue(lateReject) },
        review: vi.fn(),
        fix: vi.fn(),
        setIteration: vi.fn(),
        getEdits: vi.fn(() => []),
        liveness: vi.fn(),
      });

      setTimeout(() => controller.abort(), 10);
      const output = await promise;
      expect(output.status).toBe("aborted");

      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
