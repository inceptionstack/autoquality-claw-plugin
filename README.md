# auto-claw

`auto-claw` is an OpenClaw plugin that intercepts the final reply dispatch, reviews the turn's code edits against a workspace `review-rules.md`, and can run a deterministic review/fix loop before the user ever sees the final answer.

It is built for teams that want a configurable post-turn quality gate without hardcoding project rules into the plugin itself. The rules live in markdown in the workspace, so changing the bar is a repo edit, not a plugin release.

## What It Does

- Reads `review-rules.md` from the workspace on every handled reply.
- Tracks mutating tool calls across the root run and spawned subagents.
- Uses a gatekeeper LLM to decide whether to approve, review, fix, or stop.
- Dispatches reviewer and fixer subagents when needed.
- Delivers the final user reply only after the loop terminates.
- Appends a compact auto-claw summary when review activity occurred or the loop hit a limit.

## Install

From this repo:

```bash
npm install
npm run build
```

If you publish it:

```bash
npm install @inceptionstack/auto-claw-plugin
```

## Enable In OpenClaw

Build the plugin so `dist/plugin-entry.js` exists, then point OpenClaw at the repo/plugin directory according to your OpenClaw plugin-loading setup. The manifest file is [openclaw.plugin.json](./openclaw.plugin.json), and the runtime entry is `dist/plugin-entry.js`.

Configure the plugin under the `auto-claw` section in OpenClaw's plugin config. Example:

```json
{
  "plugins": {
    "entries": {
      "auto-claw": {
        "enabled": true,
        "config": {
          "enabled": true,
          "rulesPath": "review-rules.md",
          "anthropicApiKeyEnv": "ANTHROPIC_API_KEY",
          "gatekeeperModel": "claude-haiku-4-5-20251001",
          "defaultReviewerModel": "claude-sonnet-4-6",
          "defaultFixerModel": "claude-sonnet-4-6",
          "reviewerAgentId": "code-reviewer",
          "fixerAgentId": "coder",
          "maxIterations": 4,
          "loopTimeoutSeconds": 600,
          "subagentRunTimeoutSeconds": 180,
          "emitLivenessUpdates": true,
          "mutatingTools": ["edit", "write", "apply_patch"]
        }
      }
    }
  }
}
```

## Configuration

| Key | Purpose | Default |
| --- | --- | --- |
| `enabled` | Turns the plugin on/off without uninstalling it. | `true` |
| `rulesPath` | Workspace-relative path to the markdown rules file. | `review-rules.md` |
| `anthropicApiKeyEnv` | Env var containing the Anthropic API key. | `ANTHROPIC_API_KEY` |
| `gatekeeperModel` | Model used for the decision step. | `claude-haiku-4-5-20251001` |
| `defaultReviewerModel` | Default reviewer model when the gatekeeper does not override it. | `claude-sonnet-4-6` |
| `defaultFixerModel` | Default fixer model when the gatekeeper does not override it. | `claude-sonnet-4-6` |
| `reviewerAgentId` | Default reviewer agent profile. | `code-reviewer` |
| `fixerAgentId` | Default fixer agent profile. | `coder` |
| `maxIterations` | Hard cap for loop iterations at the handler level. | `4` |
| `loopTimeoutSeconds` | Total loop timeout. | `600` |
| `subagentRunTimeoutSeconds` | Timeout per reviewer/fixer run. | `180` |
| `emitLivenessUpdates` | Emits block replies such as `auto-claw: iteration 2`. | `true` |
| `mutatingTools` | Tools whose successful calls count as edits. | `["edit","write","apply_patch"]` |

## review-rules.md

The plugin ships an example rules file at [examples/review-rules.md](./examples/review-rules.md). Copy it into the root of the target workspace as `review-rules.md` and adapt it.

Minimal example:

```md
---
minIterations: 1
maxIterations: 4
qualityGate: "reviewer reports zero error-severity issues AND every behavior change is covered by a test"
---

# Project quality rules

## When to trigger a review
- Any edit to files under `src/`

## When to skip review
- Docs-only changes

## Reviewer instructions
Check correctness, tests, and boundary safety.

## Fixer instructions
Fix error-severity findings first and add tests for behavior changes.
```

## Development

```bash
npm install
npm run build
npm test
npx tsc --noEmit
```
