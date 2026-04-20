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

export type GatekeeperLlmLike = {
  decide(input: { system: string; user: string }): Promise<Record<string, unknown>>;
};

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
  /**
   * Optional: if the host OpenClaw has an LLM already configured (Bedrock,
   * Mantle, OpenAI, Anthropic, etc.), expose it here and autoquality-claw will use
   * it for the gatekeeper instead of constructing its own Anthropic SDK
   * client from `ANTHROPIC_API_KEY`. This is how a consumer installs the
   * plugin on a non-Anthropic-direct provider without code changes.
   */
  getGatekeeperLlm?(): GatekeeperLlmLike | undefined;
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
