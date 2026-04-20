export type SpawnSubagentParams = {
  task: string;
  agentId?: string;
  label?: string;
  model?: string;
  thinking?: "off" | "low" | "medium" | "high";
  mode?: "run" | "session";
  thread?: boolean;
  cleanup?: "keep" | "delete";
  sandbox?: "inherit" | "require";
  runTimeoutSeconds?: number;
  expectsCompletionMessage?: boolean;
};

export type SpawnSubagentCallerCtx = {
  agentSessionKey?: string;
};

export type SpawnSubagentResult =
  | { status: "ok"; runId: string; childSessionKey: string; summary: string; transcript?: unknown[] }
  | { status: "error"; error: string }
  | { status: "forbidden"; error: string }
  | { status: "timeout"; error: string };

export type SpawnSubagentFn = (
  params: SpawnSubagentParams,
  ctx: SpawnSubagentCallerCtx,
) => Promise<SpawnSubagentResult>;

export type PluginRuntime = {
  spawnSubagent: SpawnSubagentFn;
  readWorkspaceFile(relativePath: string, ctx: { workspaceDir?: string }): Promise<string | null>;
  logger: {
    debug(msg: string): void;
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  getConfigSection<T>(sectionId: string): T | undefined;
};
