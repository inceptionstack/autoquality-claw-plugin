import type { SpawnSubagentFn } from "./runtime-api.js";
import type { ReviewIssue, ReviewResult } from "./types.js";

export type DispatchReviewInput = {
  runtime: { spawnSubagent: SpawnSubagentFn };
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

export async function dispatchReview(input: DispatchReviewInput): Promise<ReviewResult> {
  const result = await input.runtime.spawnSubagent(
    {
      task: input.task,
      agentId: input.reviewerAgentId,
      label: "autoquality-claw review",
      model: input.reviewerModel,
      mode: "run",
      thread: false,
      cleanup: "delete",
      runTimeoutSeconds: input.runTimeoutSeconds,
      expectsCompletionMessage: true,
    },
    { agentSessionKey: input.parentSessionKey },
  );

  if (result.status !== "ok") {
    throw new Error(`autoquality-claw reviewer: ${result.status}: ${result.error ?? ""}`);
  }

  const rawText = String(result.summary ?? "");
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
