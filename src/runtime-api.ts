export type { OpenClawPluginApi, PluginLogger } from "openclaw/plugin-sdk/plugin-entry";
export type { PluginRuntime, SubagentRunParams, SubagentRunResult } from "openclaw/plugin-sdk";

export type GatekeeperLlmLike = {
  decide(input: { system: string; user: string }): Promise<Record<string, unknown>>;
};
