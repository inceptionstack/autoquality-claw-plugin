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
  trackSession?: (sessionKey: string | undefined, runId: string | undefined) => void;
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

const isEventShape = (event: unknown): event is AfterToolCallEvent => {
  if (!event || typeof event !== "object") {
    return false;
  }
  const candidate = event as Partial<AfterToolCallEvent>;
  return typeof candidate.toolName === "string" && typeof candidate.params === "object" && candidate.params !== null;
};

const isCtxShape = (ctx: unknown): ctx is AfterToolCallCtx => {
  return !!ctx && typeof ctx === "object";
};

export function createEditsCollector(opts: EditsCollectorOpts) {
  const editsByKey = new Map<RollupKey, Edit[]>();
  const iterationByKey = new Map<RollupKey, number>();
  const mutatingTools = new Set(opts.mutatingTools.map((tool) => tool.toLowerCase()));

  const onAfterToolCall = (rawEvent: unknown, rawCtx: unknown): void => {
    if (!isEventShape(rawEvent) || !isCtxShape(rawCtx)) {
      return;
    }

    const event = rawEvent;
    const ctx = rawCtx;
    const runId = ctx.runId ?? event.runId;

    // Track session→runId on every tool call (not only mutating ones) so
    // subagent_spawned events that only carry sessionKey can map to a runId.
    opts.trackSession?.(ctx.sessionKey, runId);

    const tool = event.toolName.toLowerCase();
    if (!mutatingTools.has(tool) || event.error) {
      return;
    }

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
