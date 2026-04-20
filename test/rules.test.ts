import { describe, expect, it } from "vitest";

import { DEFAULT_RULES, parseRules } from "../src/rules.js";

const sample = `---
minIterations: 1
maxIterations: 3
qualityGate: "no error severity issues"
---
# Review rules

## When to trigger a review
- Edits to src/

## Reviewer instructions
Be strict.
`;

describe("parseRules", () => {
  it("parses frontmatter", () => {
    const rules = parseRules(sample);

    expect(rules.minIterations).toBe(1);
    expect(rules.maxIterations).toBe(3);
    expect(rules.qualityGate).toBe("no error severity issues");
  });

  it("extracts named sections", () => {
    const rules = parseRules(sample);

    expect(rules.sections.triggerRules).toContain("Edits to src/");
    expect(rules.sections.reviewerInstructions).toContain("Be strict");
  });

  it("returns default rules when input is null/empty", () => {
    expect(parseRules(null)).toEqual(DEFAULT_RULES);
    expect(parseRules("")).toEqual(DEFAULT_RULES);
  });
});
