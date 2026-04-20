import { describe, expect, it } from "vitest";

import { defaultConfig, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("returns defaults when nothing is provided", () => {
    expect(loadConfig(undefined)).toEqual(defaultConfig);
  });

  it("merges overrides on top of defaults", () => {
    const merged = loadConfig({ maxIterations: 7, rulesPath: "other.md" });

    expect(merged.maxIterations).toBe(7);
    expect(merged.rulesPath).toBe("other.md");
    expect(merged.gatekeeperModel).toBe(defaultConfig.gatekeeperModel);
  });

  it("validates numeric bounds", () => {
    expect(() => loadConfig({ maxIterations: 0 })).toThrow(/maxIterations/);
    expect(() => loadConfig({ maxIterations: 100 })).toThrow(/maxIterations/);
  });
});
