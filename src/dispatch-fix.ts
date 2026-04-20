import type { SpawnSubagentFn } from "./runtime-api.js";

export type DispatchFixInput = {
  runtime: { spawnSubagent: SpawnSubagentFn };
  parentSessionKey?: string;
  fixerAgentId: string;
  fixerModel: string;
  prompt: string;
  runTimeoutSeconds: number;
};

export type DispatchFixResult = {
  runId: string;
  childSessionKey: string;
  summary: string;
};

export async function dispatchFix(input: DispatchFixInput): Promise<DispatchFixResult> {
  const result = await input.runtime.spawnSubagent(
    {
      task: input.prompt,
      agentId: input.fixerAgentId,
      label: "autoquality-claw fix",
      model: input.fixerModel,
      mode: "run",
      thread: false,
      cleanup: "delete",
      sandbox: "inherit",
      runTimeoutSeconds: input.runTimeoutSeconds,
      expectsCompletionMessage: true,
    },
    { agentSessionKey: input.parentSessionKey },
  );

  if (result.status !== "ok") {
    throw new Error(`autoquality-claw fixer: ${result.status}: ${result.error ?? ""}`);
  }

  return {
    runId: result.runId,
    childSessionKey: result.childSessionKey,
    summary: String(result.summary ?? ""),
  };
}
