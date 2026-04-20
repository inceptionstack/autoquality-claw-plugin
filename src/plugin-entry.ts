import { readFile } from "node:fs/promises";
import path from "node:path";

import { resolveDefaultAgentId } from "openclaw/plugin-sdk/config-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

import { loadConfig } from "./config.js";
import { createEditsCollector } from "./edits-collector.js";
import { createGatekeeper } from "./gatekeeper.js";
import { createGatekeeperLlm } from "./llm.js";
import { createReplyDispatchHandler } from "./reply-dispatch.js";
import type { GatekeeperLlmLike } from "./runtime-api.js";
import { createSubagentRegistry } from "./subagent-registry.js";

const asGatekeeperLlm = (value: unknown): GatekeeperLlmLike | undefined => {
  return value && typeof value === "object" && typeof (value as { decide?: unknown }).decide === "function"
    ? (value as GatekeeperLlmLike)
    : undefined;
};

export default definePluginEntry({
  id: "autoquality-claw",
  name: "autoquality-claw",
  description: "Post-turn code review + fix loop against workspace review-rules.md",
  register(api: OpenClawPluginApi) {
    const config = loadConfig(api.pluginConfig);
    const subagents = createSubagentRegistry();
    const edits = createEditsCollector({
      mutatingTools: config.mutatingTools,
      resolveRollupKey: (runId) => subagents.resolveRollupKey(runId),
      trackSession: subagents.trackSession,
    });
    const apiKey = process.env[config.anthropicApiKeyEnv] ?? "";
    const hostLlm = asGatekeeperLlm(api.pluginConfig?.gatekeeperLlm);
    const llm = hostLlm ?? createGatekeeperLlm({ apiKey, model: config.gatekeeperModel });
    if (!hostLlm && !apiKey) {
      api.logger.warn(
        `autoquality-claw: no host-provided LLM via pluginConfig.gatekeeperLlm and ${config.anthropicApiKeyEnv} is unset — gatekeeper calls will fail`,
      );
    }
    const gatekeeper = createGatekeeper({ llm });
    const workspaceDir = api.runtime.agent.resolveAgentWorkspaceDir(api.config, resolveDefaultAgentId(api.config));
    const readWorkspaceFile = async (relativePath: string): Promise<string | null> => {
      try {
        return await readFile(path.join(workspaceDir, relativePath), "utf-8");
      } catch {
        return null;
      }
    };
    const onReplyDispatch = createReplyDispatchHandler({
      config,
      runtime: {
        logger: api.logger,
        readWorkspaceFile,
        subagent: api.runtime.subagent,
      },
      editsCollector: edits,
      gatekeeper,
    });

    api.on("after_tool_call", async (event, ctx): Promise<void> => {
      edits.onAfterToolCall(event, ctx);
    });

    api.on(
      "subagent_spawned",
      async (event, ctx): Promise<void> => {
        const childRunId = typeof event.runId === "string" ? event.runId : undefined;
        const childSessionKey = typeof event.childSessionKey === "string" ? event.childSessionKey : undefined;
        if (!childRunId || !childSessionKey) {
          return;
        }

        const parentRunId = typeof ctx.runId === "string" ? ctx.runId : undefined;
        const parentSessionKey = typeof ctx.requesterSessionKey === "string" ? ctx.requesterSessionKey : undefined;
        const parentRollupKey =
          (parentRunId && subagents.resolveRollupKey(parentRunId)) ||
          (parentSessionKey && subagents.resolveRollupKeyForSession(parentSessionKey)) ||
          childRunId;

        subagents.onSpawned({
          childRunId,
          childSessionKey,
          parentSessionKey,
          parentRollupKey,
        });
      },
    );

    api.on("subagent_ended", async (event): Promise<void> => {
      const targetSessionKey = typeof event.targetSessionKey === "string" ? event.targetSessionKey : undefined;
      if (!targetSessionKey) {
        return;
      }
      subagents.onEnded(targetSessionKey);
    });

    api.on(
      "reply_dispatch",
      async (event, ctx) => onReplyDispatch(event, ctx),
      { priority: 100 },
    );
  },
});
