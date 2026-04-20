import { describe, expect, it } from "vitest";

import { createSubagentRegistry } from "../src/subagent-registry.js";

describe("SubagentRegistry", () => {
  it("maps child runId to parent rollup key", () => {
    const registry = createSubagentRegistry();

    registry.onSpawned({
      childRunId: "c1",
      childSessionKey: "cs1",
      parentSessionKey: "ps1",
      parentRollupKey: "root",
    });

    expect(registry.resolveRollupKey("c1")).toBe("root");
  });

  it("returns the runId itself when no mapping exists", () => {
    const registry = createSubagentRegistry();

    expect(registry.resolveRollupKey("unknown")).toBe("unknown");
  });

  it("resolves transitively (grandchild inherits root)", () => {
    const registry = createSubagentRegistry();

    registry.onSpawned({
      childRunId: "c1",
      childSessionKey: "cs1",
      parentSessionKey: "ps1",
      parentRollupKey: "root",
    });
    registry.onSpawned({
      childRunId: "c2",
      childSessionKey: "cs2",
      parentSessionKey: "cs1",
      parentRollupKey: "c1",
    });

    expect(registry.resolveRollupKey("c2")).toBe("root");
  });

  it("clears a mapping on ended", () => {
    const registry = createSubagentRegistry();

    registry.onSpawned({
      childRunId: "c1",
      childSessionKey: "cs1",
      parentSessionKey: "ps1",
      parentRollupKey: "root",
    });
    registry.onEnded("cs1");

    expect(registry.resolveRollupKey("c1")).toBe("c1");
  });
});
