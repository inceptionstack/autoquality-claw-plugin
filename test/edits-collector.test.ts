import { beforeEach, describe, expect, it } from "vitest";

import { createEditsCollector } from "../src/edits-collector.js";

describe("EditsCollector", () => {
  let collector: ReturnType<typeof createEditsCollector>;

  beforeEach(() => {
    collector = createEditsCollector({
      mutatingTools: ["edit", "write", "apply_patch"],
      resolveRollupKey: (runId) => runId,
    });
  });

  it("records an edit tool call under its runId", () => {
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/tmp/a.ts" } },
      { runId: "r1", toolName: "edit" },
    );

    expect(collector.getEdits("r1")).toHaveLength(1);
    expect(collector.getEdits("r1")[0]?.file).toBe("/tmp/a.ts");
  });

  it("ignores non-mutating tools", () => {
    collector.onAfterToolCall(
      { toolName: "read_file", params: { file_path: "/tmp/a.ts" } },
      { runId: "r1", toolName: "read_file" },
    );

    expect(collector.getEdits("r1")).toHaveLength(0);
  });

  it("ignores failed tool calls", () => {
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/tmp/a.ts" }, error: "bad args" },
      { runId: "r1", toolName: "edit" },
    );

    expect(collector.getEdits("r1")).toHaveLength(0);
  });

  it("resolves file path from each alias", () => {
    for (const key of ["file_path", "filePath", "filepath", "file", "path"] as const) {
      const freshCollector = createEditsCollector({
        mutatingTools: ["edit"],
        resolveRollupKey: (runId) => runId,
      });

      freshCollector.onAfterToolCall(
        { toolName: "edit", params: { [key]: `/tmp/${key}.ts` } },
        { runId: "rk", toolName: "edit" },
      );

      expect(freshCollector.getEdits("rk")[0]?.file).toBe(`/tmp/${key}.ts`);
    }
  });

  it("tags edits with the current iteration", () => {
    collector.setIteration("r1", 2);
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/tmp/a.ts" } },
      { runId: "r1", toolName: "edit" },
    );

    expect(collector.getEdits("r1")[0]?.iteration).toBe(2);
  });

  it("clears a rollup key", () => {
    collector.onAfterToolCall(
      { toolName: "edit", params: { file_path: "/tmp/a.ts" } },
      { runId: "r1", toolName: "edit" },
    );

    collector.clear("r1");

    expect(collector.getEdits("r1")).toHaveLength(0);
  });
});
