import { describe, expect, it } from "vitest";

import { createEditsCollector } from "../src/edits-collector.js";
import { createSubagentRegistry } from "../src/subagent-registry.js";

describe("edits-collector + subagent-registry", () => {
  it("rolls subagent edits under the top-level runId", () => {
    const registry = createSubagentRegistry();
    const collector = createEditsCollector({
      mutatingTools: ["edit"],
      resolveRollupKey: (runId) => registry.resolveRollupKey(runId),
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
});
