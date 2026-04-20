import type { Edit, RollupKey } from "./types.js";

export type AfterToolCallEvent = {
  toolName: string;
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  result?: unknown;
  error?: string;
  durationMs?: number;
};

export type AfterToolCallCtx = {
  runId?: string;
  sessionKey?: string;
  toolName: string;
};

export type EditsCollectorOpts = {
  mutatingTools: string[];
  resolveRollupKey: (runId: string) => RollupKey;
};

const PATH_KEYS = ["file_path", "filePath", "filepath", "file", "path"] as const;

const extractFile = (params: Record<string, unknown>): string | undefined => {
  for (const key of PATH_KEYS) {
    const value = params[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
};

export function createEditsCollector(opts: EditsCollectorOpts) {
  const editsByKey = new Map<RollupKey, Edit[]>();
  const iterationByKey = new Map<RollupKey, number>();
  const mutatingTools = new Set(opts.mutatingTools.map((tool) => tool.toLowerCase()));

  const onAfterToolCall = (event: AfterToolCallEvent, ctx: AfterToolCallCtx): void => {
    const tool = event.toolName.toLowerCase();
    if (!mutatingTools.has(tool) || event.error) {
      return;
    }

    const runId = ctx.runId ?? event.runId;
    if (!runId) {
      return;
    }

    const rollupKey = opts.resolveRollupKey(runId);
    const edit: Edit = {
      rollupKey,
      runId,
      tool: tool as Edit["tool"],
      file: extractFile(event.params),
      params: event.params,
      at: Date.now(),
      iteration: iterationByKey.get(rollupKey) ?? 0,
    };
    const edits = editsByKey.get(rollupKey) ?? [];

    edits.push(edit);
    editsByKey.set(rollupKey, edits);
  };

  return {
    onAfterToolCall,
    setIteration(rollupKey: RollupKey, iteration: number): void {
      iterationByKey.set(rollupKey, iteration);
    },
    getEdits(rollupKey: RollupKey): Edit[] {
      return editsByKey.get(rollupKey) ?? [];
    },
    clear(rollupKey: RollupKey): void {
      editsByKey.delete(rollupKey);
      iterationByKey.delete(rollupKey);
    },
    snapshot(): Map<RollupKey, Edit[]> {
      return new Map(editsByKey);
    },
  };
}
