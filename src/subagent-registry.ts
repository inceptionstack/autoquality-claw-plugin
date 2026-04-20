import type { RollupKey } from "./types.js";

export type SpawnedInput = {
  childRunId: string;
  childSessionKey: string;
  parentSessionKey?: string;
  parentRollupKey: RollupKey;
};

export function createSubagentRegistry() {
  const parentByChildRunId = new Map<string, RollupKey>();
  const runIdByChildSessionKey = new Map<string, string>();
  // Tracks the current active runId per sessionKey so subagent_spawned events
  // (which only carry the parent sessionKey) can resolve to the correct rollup.
  const runIdBySessionKey = new Map<string, string>();

  const resolveRollupKey = (runId: string): RollupKey => {
    let current: RollupKey = runId;
    const seen = new Set<RollupKey>();

    while (parentByChildRunId.has(current)) {
      if (seen.has(current)) {
        break;
      }

      seen.add(current);
      current = parentByChildRunId.get(current) ?? current;
    }

    return current;
  };

  const resolveRollupKeyForSession = (sessionKey: string): RollupKey | undefined => {
    const runId = runIdBySessionKey.get(sessionKey);
    if (!runId) {
      return undefined;
    }

    return resolveRollupKey(runId);
  };

  const trackSession = (sessionKey: string | undefined, runId: string | undefined): void => {
    if (!sessionKey || !runId) {
      return;
    }

    runIdBySessionKey.set(sessionKey, runId);
  };

  const onSpawned = (input: SpawnedInput): void => {
    parentByChildRunId.set(input.childRunId, input.parentRollupKey);
    runIdByChildSessionKey.set(input.childSessionKey, input.childRunId);
    runIdBySessionKey.set(input.childSessionKey, input.childRunId);
  };

  const onEnded = (childSessionKey: string): void => {
    const runId = runIdByChildSessionKey.get(childSessionKey);
    if (!runId) {
      return;
    }

    parentByChildRunId.delete(runId);
    runIdByChildSessionKey.delete(childSessionKey);
    runIdBySessionKey.delete(childSessionKey);
  };

  return { resolveRollupKey, resolveRollupKeyForSession, trackSession, onSpawned, onEnded };
}
