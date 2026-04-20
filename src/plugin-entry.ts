import { loadConfig } from "./config.js";
import { createEditsCollector } from "./edits-collector.js";
import { createGatekeeper } from "./gatekeeper.js";
import { createGatekeeperLlm } from "./llm.js";
import { createReplyDispatchHandler, type ReplyDispatchContext, type ReplyDispatchEvent } from "./reply-dispatch.js";
import type { PluginEntry, PluginHookRegistration, PluginRuntime } from "./runtime-api.js";
import { createSubagentRegistry } from "./subagent-registry.js";

type SubagentSpawnedEvent = {
  runId?: string;
  childSessionKey?: string;
};

type SubagentSpawnedContext = {
  requesterSessionKey?: string;
  requesterRunId?: string;
};

type SubagentEndedEvent = {
  targetSessionKey?: string;
};

const asObject = (value: unknown): Record<string, unknown> | undefined => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
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
      trackSession: subagents.trackSession,
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
        edits.onAfterToolCall(event, ctx);
      },
    });

    registerHook(register, {
      name: "subagent_spawned",
      pluginId: "auto-claw",
      handler: async (rawEvent: unknown, rawCtx: unknown): Promise<void> => {
        const event = asObject(rawEvent) as SubagentSpawnedEvent | undefined;
        const ctx = asObject(rawCtx) as SubagentSpawnedContext | undefined;
        if (!event || !ctx) {
          return;
        }

        const childRunId = typeof event.runId === "string" ? event.runId : undefined;
        const childSessionKey = typeof event.childSessionKey === "string" ? event.childSessionKey : undefined;
        if (!childRunId || !childSessionKey) {
          return;
        }

        // Prefer explicit requesterRunId; fall back to resolving via session→runId map.
        const parentRunId = typeof ctx.requesterRunId === "string" ? ctx.requesterRunId : undefined;
        const parentSessionKey = typeof ctx.requesterSessionKey === "string" ? ctx.requesterSessionKey : undefined;
        const parentRollupKey =
          (parentRunId && subagents.resolveRollupKey(parentRunId)) ||
          (parentSessionKey && subagents.resolveRollupKeyForSession(parentSessionKey)) ||
          // No known parent run: treat this child as its own rollup root.
          childRunId;

        subagents.onSpawned({
          childRunId,
          childSessionKey,
          parentSessionKey,
          parentRollupKey,
        });
      },
    });

    registerHook(register, {
      name: "subagent_ended",
      pluginId: "auto-claw",
      handler: async (rawEvent: unknown): Promise<void> => {
        const event = asObject(rawEvent) as SubagentEndedEvent | undefined;
        const targetSessionKey = event && typeof event.targetSessionKey === "string" ? event.targetSessionKey : undefined;
        if (!targetSessionKey) {
          return;
        }
        subagents.onEnded(targetSessionKey);
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

