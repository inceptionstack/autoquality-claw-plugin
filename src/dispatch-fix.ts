type SubagentApi = {
  run(params: { sessionKey: string; message: string; provider?: string; model?: string; deliver?: boolean }): Promise<{ runId: string }>;
  waitForRun(params: { runId: string; timeoutMs?: number }): Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
  getSessionMessages(params: { sessionKey: string; limit?: number }): Promise<{ messages: unknown[] }>;
};

export type DispatchFixInput = {
  runtime: { subagent: SubagentApi };
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

const extractText = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("\n");
  }
  if (!value || typeof value !== "object") {
    return "";
  }

  const record = value as Record<string, unknown>;
  for (const key of ["text", "body", "message", "content"]) {
    const text = extractText(record[key]);
    if (text) {
      return text;
    }
  }

  return "";
};

const extractLatestAssistantSummary = (messages: unknown[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") {
      continue;
    }

    const record = message as Record<string, unknown>;
    const role = typeof record.role === "string" ? record.role : undefined;
    if (role && role !== "assistant") {
      continue;
    }

    const text = extractText(record);
    if (text) {
      return text;
    }
  }

  return "";
};

export async function dispatchFix(input: DispatchFixInput): Promise<DispatchFixResult> {
  const sessionKey = `agent:main:subagent:autoquality-fix-${Date.now()}`;
  const { runId } = await input.runtime.subagent.run({
    sessionKey,
    message: input.prompt,
    model: input.fixerModel,
    deliver: false,
  });
  const waitResult = await input.runtime.subagent.waitForRun({
    runId,
    timeoutMs: input.runTimeoutSeconds * 1000,
  });

  if (waitResult.status !== "ok") {
    throw new Error(`autoquality-claw fixer: ${waitResult.status}: ${waitResult.error ?? ""}`);
  }

  const { messages } = await input.runtime.subagent.getSessionMessages({
    sessionKey,
    limit: 5,
  });

  return {
    runId,
    childSessionKey: sessionKey,
    summary: extractLatestAssistantSummary(messages),
  };
}
