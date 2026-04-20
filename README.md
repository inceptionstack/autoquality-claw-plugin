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

## LLM Provider

`auto-claw` tries to **inherit the host's LLM** first. If OpenClaw exposes `runtime.getGatekeeperLlm()` — typical when OpenClaw is already configured for Bedrock, Mantle, OpenAI, or any other provider — the plugin uses that client directly. No plugin-side credentials needed.

Only when the host does **not** expose a client does the plugin fall back to constructing its own Anthropic SDK client from the env var named by `anthropicApiKeyEnv` (default `ANTHROPIC_API_KEY`). The fallback exists so the plugin works standalone; in any real OpenClaw install, provider inheritance is the intended path.

## Install

### Option A — from GitHub (most users)

```bash
npm install github:inceptionstack/autoquality-claw-plugin#v0.1.0
```

The published tarball ships `dist/`, the manifest, and `examples/`. No build step on the consumer side.

### Option B — from npm

When the package is published to npm:

```bash
npm install @inceptionstack/auto-claw-plugin
```

### Option C — from source

```bash
git clone https://github.com/inceptionstack/autoquality-claw-plugin.git
cd autoquality-claw-plugin
npm install
npm run build
```

## Enable In OpenClaw

Point OpenClaw at the installed package or the cloned directory using your OpenClaw plugin-loading config. The manifest file is [openclaw.plugin.json](./openclaw.plugin.json); the runtime entry is `dist/plugin-entry.js`.

Example OpenClaw config section:

```json
{
  "plugins": {
    "entries": {
      "auto-claw": {
        "enabled": true,
        "config": {
          "enabled": true,
          "rulesPath": "review-rules.md",
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

When the host provides its own LLM, you do not need to set `anthropicApiKeyEnv` — it is only read on the fallback path.

## Configuration

| Key | Purpose | Default |
| --- | --- | --- |
| `enabled` | Turns the plugin on/off without uninstalling it. | `true` |
| `rulesPath` | Workspace-relative path to the markdown rules file. | `review-rules.md` |
| `anthropicApiKeyEnv` | Fallback env var name for direct Anthropic SDK when the host does not expose an LLM. | `ANTHROPIC_API_KEY` |
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

Ship [examples/review-rules.md](./examples/review-rules.md) into the root of the target workspace and adapt it. Minimal example:

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

## CI/CD

Every push and PR runs the GitHub Actions workflow in [`.github/workflows/ci.yml`](.github/workflows/ci.yml): install → typecheck → test → build. Release tags (`v*`) additionally publish the tarball as a GitHub Release asset via [`.github/workflows/release.yml`](.github/workflows/release.yml).

## License

MIT — see [LICENSE](./LICENSE).
