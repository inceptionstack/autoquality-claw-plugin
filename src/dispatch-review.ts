import type { ReviewIssue, ReviewResult } from "./types.js";

type SubagentApi = {
  run(params: { sessionKey: string; message: string; provider?: string; model?: string; deliver?: boolean }): Promise<{ runId: string }>;
  waitForRun(params: { runId: string; timeoutMs?: number }): Promise<{ status: "ok" | "error" | "timeout"; error?: string }>;
  getSessionMessages(params: { sessionKey: string; limit?: number }): Promise<{ messages: unknown[] }>;
};

export type DispatchReviewInput = {
  runtime: { subagent: SubagentApi };
  parentSessionKey?: string;
  reviewerAgentId: string;
  reviewerModel: string;
  task: string;
  runTimeoutSeconds: number;
};

const parseIssues = (text: string): ReviewIssue[] => {
  const issues: ReviewIssue[] = [];

  for (const line of text.split("\n")) {
    const match = line.match(/\b(error|warn|info)\b[:\s-]+(?:([^\s:]+):(\d+)\s*[—-]\s*)?(.+?)\s*$/i);
    if (!match) {
      continue;
    }

    issues.push({
      severity: match[1].toLowerCase() as ReviewIssue["severity"],
      file: match[2],
      line: match[3] ? Number(match[3]) : undefined,
      message: match[4].trim(),
    });
  }

  return issues;
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

export async function dispatchReview(input: DispatchReviewInput): Promise<ReviewResult> {
  const sessionKey = `agent:main:subagent:autoquality-review-${Date.now()}`;
  const { runId } = await input.runtime.subagent.run({
    sessionKey,
    message: input.task,
    model: input.reviewerModel,
    deliver: false,
  });
  const waitResult = await input.runtime.subagent.waitForRun({
    runId,
    timeoutMs: input.runTimeoutSeconds * 1000,
  });

  if (waitResult.status !== "ok") {
    throw new Error(`autoquality-claw reviewer: ${waitResult.status}: ${waitResult.error ?? ""}`);
  }

  const { messages } = await input.runtime.subagent.getSessionMessages({
    sessionKey,
    limit: 5,
  });
  const rawText = extractLatestAssistantSummary(messages);
  const issues = parseIssues(rawText);
  const verdict: ReviewResult["verdict"] = issues.some((issue) => issue.severity === "error")
    ? "issues"
    : /\b(looks good|lgtm|no issues)\b/i.test(rawText)
      ? "clean"
      : issues.length > 0
        ? "issues"
        : "uncertain";

  return { rawText, issues, verdict };
}
