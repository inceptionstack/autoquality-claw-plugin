import type { ReviewRules } from "./rules.js";
import type { Decision, Edit, LoopHistoryItem } from "./types.js";

export type GatekeeperInput = {
  rules: ReviewRules;
  edits: Edit[];
  history: LoopHistoryItem[];
  iteration: number;
  lastReplyText: string;
};

export type GatekeeperDeps = {
  llm: {
    decide(input: { system: string; user: string }): Promise<Record<string, unknown>>;
  };
};

const VALID_ACTIONS = new Set<Decision["action"]>(["approve", "stop", "review", "fix"]);

const summarizeEdit = (edit: Edit): string => {
  const extras: string[] = [];

  if (edit.tool === "edit") {
    const oldLength = typeof edit.params.old_string === "string" ? edit.params.old_string.length : 0;
    const newLength = typeof edit.params.new_string === "string" ? edit.params.new_string.length : 0;

    extras.push(`oldLen=${oldLength}`, `newLen=${newLength}`);
  }

  if (edit.tool === "write") {
    const writeLength = typeof edit.params.content === "string" ? edit.params.content.length : 0;

    extras.push(`writeLen=${writeLength}`);
  }

  if (edit.tool === "apply_patch") {
    const patchLength = typeof edit.params.patch === "string" ? edit.params.patch.length : 0;

    extras.push(`patchLen=${patchLength}`);
  }

  return `- iter=${edit.iteration} tool=${edit.tool} file=${edit.file ?? "?"} ${extras.join(" ")}`.trim();
};

const buildUserPrompt = (input: GatekeeperInput): string => {
  const editsBlock = input.edits.length > 0 ? input.edits.map(summarizeEdit).join("\n") : "(no edits this turn)";
  const historyBlock =
    input.history.length > 0
      ? input.history.map((item) => `- ${item.kind} @iter${item.iteration}`).join("\n")
      : "(no history)";

  return [
    "# Review rules (verbatim review-rules.md)",
    input.rules.sections.raw || "(no rules file — using plugin defaults)",
    "",
    "# Parsed rule values",
    `minIterations: ${input.rules.minIterations}`,
    `maxIterations: ${input.rules.maxIterations}`,
    `qualityGate: ${input.rules.qualityGate}`,
    "",
    "# Current state",
    `iteration: ${input.iteration}`,
    "",
    "## Last agent reply",
    input.lastReplyText.slice(0, 2000),
    "",
    "## Edits so far",
    editsBlock,
    "",
    "## Loop history",
    historyBlock,
    "",
    "# Task",
    'Decide the single next step. Call the "decide" tool with one of:',
    '- "approve" (quality gate met, deliver to user)',
    '- "stop" (hard stop — include reason)',
    '- "review" (spawn reviewer — you may set reviewerModel / reviewerAgentId / focus)',
    '- "fix" (spawn fixer — you MUST include fixerPrompt; you may set fixerModel / fixerAgentId)',
    "",
    "Anything in the verbatim rules above that talks about models, escalation, or focus hints is authoritative — apply it.",
  ].join("\n");
};

const SYSTEM_PROMPT =
  "You are the auto-claw gatekeeper. Read review-rules.md verbatim and the current loop state, " +
  "then decide the single next step. Be deterministic: if rules say skip, approve. If the quality gate is met, approve. " +
  "Never request both review and fix in the same step.";

export function createGatekeeper(deps: GatekeeperDeps) {
  const decide = async (input: GatekeeperInput): Promise<Decision> => {
    // The loop is authoritative on max-iterations bounds (it applies
    // effectiveMax = min(config, rules)). We don't duplicate that check here;
    // returning "stop" from the gatekeeper would be reported as
    // "stopped by gatekeeper" in the output instead of "max iterations".

    const rawDecision = await deps.llm.decide({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(input),
    });
    const action = typeof rawDecision.action === "string" ? rawDecision.action : "stop";

    if (!VALID_ACTIONS.has(action as Decision["action"])) {
      return { action: "stop", reason: `invalid action from gatekeeper: ${action}` };
    }

    if (action === "approve") {
      return { action: "approve", note: String(rawDecision.note ?? "") };
    }

    if (action === "stop") {
      return { action: "stop", reason: String(rawDecision.reason ?? "gatekeeper stop") };
    }

    if (action === "review") {
      return {
        action: "review",
        reviewerModel: typeof rawDecision.reviewerModel === "string" ? rawDecision.reviewerModel : undefined,
        reviewerAgentId: typeof rawDecision.reviewerAgentId === "string" ? rawDecision.reviewerAgentId : undefined,
        focus: typeof rawDecision.focus === "string" ? rawDecision.focus : undefined,
      };
    }

    const fixerPrompt = typeof rawDecision.fixerPrompt === "string" ? rawDecision.fixerPrompt : "";
    if (!fixerPrompt) {
      return { action: "stop", reason: "fix decision missing fixerPrompt" };
    }

    return {
      action: "fix",
      fixerPrompt,
      fixerModel: typeof rawDecision.fixerModel === "string" ? rawDecision.fixerModel : undefined,
      fixerAgentId: typeof rawDecision.fixerAgentId === "string" ? rawDecision.fixerAgentId : undefined,
    };
  };

  return { decide };
}
