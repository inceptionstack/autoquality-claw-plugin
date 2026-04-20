import { loadConfig } from "./config.js";
import { createEditsCollector, type AfterToolCallCtx, type AfterToolCallEvent } from "./edits-collector.js";
import { createGatekeeper } from "./gatekeeper.js";
import { createGatekeeperLlm } from "./llm.js";
import { createReplyDispatchHandler, type ReplyDispatchContext, type ReplyDispatchEvent } from "./reply-dispatch.js";
import type { PluginEntry, PluginHookRegistration, PluginRuntime } from "./runtime-api.js";
import { createSubagentRegistry } from "./subagent-registry.js";

type SubagentSpawnedEvent = {
  runId: string;
  childSessionKey: string;
};

type SubagentSpawnedContext = {
  requesterSessionKey?: string;
};

type SubagentEndedEvent = {
  targetSessionKey: string;
};

const registerHook = (register: (registration: PluginHookRegistration) => void, registration: PluginHookRegistration): void => {
  register(registration);
};

export const plugin: PluginEntry = {
  id: "auto-claw",
  async registerHooks(register, runtime: PluginRuntime): Promise<void> {
    const config = loadConfig(runtime.getConfigSection("auto-claw"));
    const subagents = createSubagentRegistry();
    const edits = createEditsCollector({
      mutatingTools: config.mutatingTools,
      resolveRollupKey: (runId) => subagents.resolveRollupKey(runId),
    });
    const apiKey = process.env[config.anthropicApiKeyEnv] ?? "";
    const llm = createGatekeeperLlm({ apiKey, model: config.gatekeeperModel });
    const gatekeeper = createGatekeeper({ llm });
    const onReplyDispatch = createReplyDispatchHandler({
      config,
      runtime,
      editsCollector: edits,
      gatekeeper,
    });

    registerHook(register, {
      name: "after_tool_call",
      pluginId: "auto-claw",
      handler: async (event: unknown, ctx: unknown): Promise<void> => {
        edits.onAfterToolCall(event as AfterToolCallEvent, ctx as AfterToolCallCtx);
      },
    });

    registerHook(register, {
      name: "subagent_spawned",
      pluginId: "auto-claw",
      handler: async (event: unknown, ctx: unknown): Promise<void> => {
        const spawnedEvent = event as SubagentSpawnedEvent;
        const spawnedContext = ctx as SubagentSpawnedContext;
        const parentRollupKey = subagents.resolveRollupKey(
          spawnedContext.requesterSessionKey ?? spawnedEvent.childSessionKey,
        );

        subagents.onSpawned({
          childRunId: spawnedEvent.runId,
          childSessionKey: spawnedEvent.childSessionKey,
          parentSessionKey: spawnedContext.requesterSessionKey,
          parentRollupKey,
        });
      },
    });

    registerHook(register, {
      name: "subagent_ended",
      pluginId: "auto-claw",
      handler: async (event: unknown): Promise<void> => {
        subagents.onEnded((event as SubagentEndedEvent).targetSessionKey);
      },
    });

    registerHook(register, {
      name: "reply_dispatch",
      pluginId: "auto-claw",
      priority: 100,
      handler: async (event: unknown, ctx: unknown) =>
        onReplyDispatch(event as ReplyDispatchEvent, ctx as ReplyDispatchContext),
    });
  },
};
