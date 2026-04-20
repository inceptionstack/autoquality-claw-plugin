import type { LoopOutcome } from "./types.js";

export type FormatInput = {
  originalReply: string;
  outcome: LoopOutcome;
};

const STATUS_LABELS: Record<LoopOutcome["status"], string> = {
  approved: "approved",
  "max-iterations": "max iterations reached",
  stopped: "stopped by gatekeeper",
  timeout: "timeout",
  aborted: "aborted",
  error: "error",
};

const indent = (text: string): string => text.split("\n").map((line) => `  ${line}`).join("\n");

export function formatFinalMessage({ originalReply, outcome }: FormatInput): string {
  const hadReviewActivity = outcome.history.some((item) => item.kind === "review" || item.kind === "fix");
  if (outcome.status === "approved" && !hadReviewActivity) {
    return originalReply;
  }

  const parts: string[] = [
    originalReply,
    "",
    `- autoquality-claw · ${STATUS_LABELS[outcome.status]} · iterations: ${outcome.iterations} -`,
  ];

  for (const item of outcome.history) {
    if (item.kind === "decision") {
      parts.push(`[iter ${item.iteration}] decision: ${item.decision.action}`);
      continue;
    }

    if (item.kind === "review") {
      const errorCount = item.result.issues.filter((issue) => issue.severity === "error").length;
      const warningCount = item.result.issues.filter((issue) => issue.severity === "warn").length;

      parts.push(`[iter ${item.iteration}] review: verdict=${item.result.verdict} errors=${errorCount} warnings=${warningCount}`);
      const snippet = item.result.rawText.split("\n").slice(0, 6).join("\n");
      if (snippet.trim()) {
        parts.push(indent(snippet));
      }
      continue;
    }

    if (item.kind === "fix") {
      parts.push(`[iter ${item.iteration}] fix: ${item.summary} (edits=${item.editCount})`);
      continue;
    }

    parts.push(`[iter ${item.iteration}] error: ${item.error}`);
  }

  return parts.join("\n");
}
