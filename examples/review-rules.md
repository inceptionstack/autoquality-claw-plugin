---
minIterations: 1
maxIterations: 4
qualityGate: "reviewer reports zero error-severity issues AND every behavior change is covered by a test AND no TODO/FIXME left in touched files"
---

# Project quality rules

These rules control the autoquality-claw post-turn review loop. The gatekeeper LLM
reads this file verbatim on every turn and decides what to do next.

## When to trigger a review
- Any edit to files under `src/`, `lib/`, `app/`, `packages/`, `extensions/`
- Any new exported function, class, or public API
- Any change to a test file that adds, removes, or modifies assertions
- Any change touching auth, crypto, access control, or secret handling
- Any new dependency added to a manifest (`package.json`, `pyproject.toml`, `go.mod`, etc.)

## When to skip review
- Docs-only changes: `*.md`, files under `docs/`, top-level README
- Pure formatting changes (whitespace, import ordering, trailing commas)
- Generated files (`*.generated.*`, `dist/**`, `build/**`, lockfiles)
- Changes confined to comments

## Reviewer instructions
The reviewer should evaluate the diff for:

1. **Correctness** — does the change actually do what the turn intended? Walk the code path with a realistic input.
2. **Readability** — can a new engineer understand this without reading surrounding files? Names should match behavior. Functions over ~40 lines need a reason.
3. **Unit tests** — any new behavior MUST have a test at seam depth. Bug fixes MUST include a regression test. A test that only exercises the happy path is incomplete.
4. **Error handling at boundaries** — external input (user, network, files, env) must be validated. Internal calls can trust each other.
5. **No smell markers left** — `TODO`, `FIXME`, `XXX`, commented-out code, unused exports, dead branches.
6. **Security basics** — no secrets in code, no `eval`, no shell-injection, no SQL string concatenation, no unbounded recursion, no `any` in new TypeScript.

Return findings one per line, each prefixed with one of:
- `error:` — must be fixed before shipping (blocks the quality gate)
- `warn:` — should be fixed but not a release-blocker
- `info:` — suggestion, no action required

When possible include `file:line — message`. End your review with one of the
tokens `LGTM`, `Needs fix`, or `Uncertain`.

## Fixer instructions
When the reviewer returns `Needs fix`, the fixer agent should:

- Address every `error:` finding first, one at a time, smallest diff per fix.
- For each fixed finding, add or update a test that would have caught the
  original issue — prefer unit tests, fall back to integration only when the
  seam is genuinely out of reach.
- Do not refactor beyond what the fix requires. No renames, no moves, no style
  sweeps. Preserve the original author's structure.
- Do not touch files outside those mentioned in the findings unless strictly
  necessary — and when it is necessary, call it out in the summary.
- Leave `warn:` findings alone unless they are trivial (< 5 lines) to fix.

## Escalation hints (optional, consumed by the gatekeeper)
- If a finding mentions auth, crypto, or access control, prefer a stronger
  model for the reviewer on the next iteration.
- If the same finding repeats across two iterations, stop and return the
  current state to the user with a clear note — something is stuck.
- If no edits were made this turn, skip review entirely and approve.
