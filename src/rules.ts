export type ReviewRules = {
  minIterations: number;
  maxIterations: number;
  qualityGate: string;
  sections: {
    triggerRules: string;
    skipRules: string;
    reviewerInstructions: string;
    fixerInstructions: string;
    raw: string;
  };
};

export const DEFAULT_RULES: ReviewRules = {
  minIterations: 1,
  maxIterations: 3,
  qualityGate: "reviewer reports no error-severity issues",
  sections: {
    triggerRules: "Review any edit to source files.",
    skipRules: "Skip docs-only and pure-formatting changes.",
    reviewerInstructions: "Check correctness, tests, and boundary safety.",
    fixerInstructions: "Address error-severity issues first.",
    raw: "",
  },
};

const SECTION_MAP: Record<string, keyof ReviewRules["sections"]> = {
  "when to trigger a review": "triggerRules",
  "trigger rules": "triggerRules",
  "when to skip review": "skipRules",
  "skip rules": "skipRules",
  "reviewer instructions": "reviewerInstructions",
  "fixer instructions": "fixerInstructions",
};

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const KEY_VALUE_PATTERN = /^\s*([a-zA-Z]+)\s*:\s*(.+?)\s*$/;
const SECTION_HEADER_PATTERN = /^##\s+(.+?)\s*$/;

const parsePositiveInt = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return undefined;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
};

const parseFrontmatter = (
  input: string,
): { body: string; values: Partial<Pick<ReviewRules, "minIterations" | "maxIterations" | "qualityGate">>; warnings: string[] } => {
  const match = input.match(FRONTMATTER_PATTERN);
  if (!match) {
    return { body: input, values: {}, warnings: [] };
  }

  const [, frontmatter, body = ""] = match;
  const values: Partial<Pick<ReviewRules, "minIterations" | "maxIterations" | "qualityGate">> = {};
  const warnings: string[] = [];

  for (const line of frontmatter.split("\n")) {
    const keyValueMatch = line.match(KEY_VALUE_PATTERN);
    if (!keyValueMatch) {
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key === "minIterations") {
      const parsed = parsePositiveInt(value);
      if (parsed === undefined) {
        warnings.push(`invalid minIterations '${value}' — using default`);
        continue;
      }
      values.minIterations = parsed;
      continue;
    }

    if (key === "maxIterations") {
      const parsed = parsePositiveInt(value);
      if (parsed === undefined || parsed < 1) {
        warnings.push(`invalid maxIterations '${value}' — using default`);
        continue;
      }
      values.maxIterations = parsed;
      continue;
    }

    if (key === "qualityGate") {
      values.qualityGate = value;
    }
  }

  // Guard against inverted ranges.
  if (
    values.minIterations !== undefined &&
    values.maxIterations !== undefined &&
    values.minIterations > values.maxIterations
  ) {
    warnings.push(
      `minIterations (${values.minIterations}) > maxIterations (${values.maxIterations}) — using defaults`,
    );
    delete values.minIterations;
    delete values.maxIterations;
  }

  return { body, values, warnings };
};

const extractSections = (body: string): ReviewRules["sections"] => {
  const buffers: Record<keyof ReviewRules["sections"], string[]> = {
    triggerRules: [],
    skipRules: [],
    reviewerInstructions: [],
    fixerInstructions: [],
    raw: [],
  };

  let currentSection: keyof ReviewRules["sections"] | null = null;

  for (const line of body.split("\n")) {
    const sectionMatch = line.match(SECTION_HEADER_PATTERN);
    if (sectionMatch) {
      currentSection = SECTION_MAP[sectionMatch[1].toLowerCase().trim()] ?? null;
      continue;
    }

    if (currentSection) {
      buffers[currentSection].push(line);
    }
  }

  return {
    triggerRules: buffers.triggerRules.join("\n").trim() || DEFAULT_RULES.sections.triggerRules,
    skipRules: buffers.skipRules.join("\n").trim() || DEFAULT_RULES.sections.skipRules,
    reviewerInstructions:
      buffers.reviewerInstructions.join("\n").trim() || DEFAULT_RULES.sections.reviewerInstructions,
    fixerInstructions:
      buffers.fixerInstructions.join("\n").trim() || DEFAULT_RULES.sections.fixerInstructions,
    raw: body,
  };
};

export function parseRules(input: string | null | undefined): ReviewRules {
  if (!input || !input.trim()) {
    return DEFAULT_RULES;
  }

  const { body, values } = parseFrontmatter(input);

  return {
    minIterations: values.minIterations ?? DEFAULT_RULES.minIterations,
    maxIterations: values.maxIterations ?? DEFAULT_RULES.maxIterations,
    qualityGate: values.qualityGate ?? DEFAULT_RULES.qualityGate,
    sections: {
      ...extractSections(body),
      raw: input,
    },
  };
}

export function parseRulesWithWarnings(input: string | null | undefined): {
  rules: ReviewRules;
  warnings: string[];
} {
  if (!input || !input.trim()) {
    return { rules: DEFAULT_RULES, warnings: [] };
  }

  const { body, values, warnings } = parseFrontmatter(input);

  return {
    rules: {
      minIterations: values.minIterations ?? DEFAULT_RULES.minIterations,
      maxIterations: values.maxIterations ?? DEFAULT_RULES.maxIterations,
      qualityGate: values.qualityGate ?? DEFAULT_RULES.qualityGate,
      sections: {
        ...extractSections(body),
        raw: input,
      },
    },
    warnings,
  };
}
