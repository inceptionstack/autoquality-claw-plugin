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

export type PluginHookName =
  | "after_tool_call"
  | "subagent_spawned"
  | "subagent_ended"
  | "reply_dispatch";

export type PluginHookRegistration = {
  name: PluginHookName;
  priority?: number;
  pluginId?: string;
  handler: (...args: unknown[]) => unknown;
};

export type PluginRegisterFn = (registration: PluginHookRegistration) => void;

export type PluginEntry = {
  id: string;
  registerHooks(register: PluginRegisterFn, runtime: PluginRuntime): void | Promise<void>;
};
