import { describe, expect, it } from "vitest";

import { createEditsCollector } from "../src/edits-collector.js";
import { createSubagentRegistry } from "../src/subagent-registry.js";

describe("edits-collector + subagent-registry", () => {
  it("rolls subagent edits under the top-level runId", () => {
    const registry = createSubagentRegistry();
    const collector = createEditsCollector({
      mutatingTools: ["edit"],
      resolveRollupKey: (runId) => registry.resolveRollupKey(runId),
      trackSession: registry.trackSession,
    });

    registry.onSpawned({
      childRunId: "child1",
      childSessionKey: "cs1",
      parentRollupKey: "root",
    });

    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/a.ts" } },
      { runId: "root", toolName: "edit" },
    );
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/b.ts" } },
      { runId: "child1", toolName: "edit" },
    );

    expect(collector.getEdits("root").map((edit) => edit.file)).toEqual(["/a.ts", "/b.ts"]);
    expect(collector.getEdits("child1")).toHaveLength(0);
  });

  it("resolves the parent rollup from a sessionKey when spawn event lacks requesterRunId", () => {
    const registry = createSubagentRegistry();
    const collector = createEditsCollector({
      mutatingTools: ["edit"],
      resolveRollupKey: (runId) => registry.resolveRollupKey(runId),
      trackSession: registry.trackSession,
    });

    // Parent runs a tool first — collector learns session→runId mapping.
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/main.ts" } },
      { runId: "root-run", sessionKey: "parent-session", toolName: "edit" },
    );

    // Now we know the parent's sessionKey but spawn payload usually only
    // carries the parent's sessionKey — resolve through session→runId map.
    const parentRollupKey = registry.resolveRollupKeyForSession("parent-session");
    expect(parentRollupKey).toBe("root-run");

    registry.onSpawned({
      childRunId: "child-run",
      childSessionKey: "child-session",
      parentSessionKey: "parent-session",
      parentRollupKey: parentRollupKey!,
    });

    // Child subagent edits a file — should roll up under the root run.
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/child.ts" } },
      { runId: "child-run", sessionKey: "child-session", toolName: "edit" },
    );

    expect(collector.getEdits("root-run").map((edit) => edit.file)).toEqual(["/main.ts", "/child.ts"]);
  });
});
