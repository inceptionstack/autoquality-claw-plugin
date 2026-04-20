# Changelog

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-04-20

First version that actually works against a real OpenClaw host. All prior versions used a hand-rolled plugin contract that didn't match the real SDK.

### Changed (BREAKING — adapter/wiring only, zero business-logic changes)
- Entry shape migrated to `definePluginEntry({ register(api) { api.on(hook, handler, { priority }) } })` — matches the real OpenClaw plugin SDK contract.
- Hook registration uses `api.on(hookName, handler, opts)` instead of a hand-rolled `register({ name, handler })`.
- Config accessed via `api.pluginConfig` instead of `runtime.getConfigSection(...)`.
- Subagent flow is now the real 3-step API: `api.runtime.subagent.run()` → `waitForRun()` → `getSessionMessages()`.
- `src/runtime-api.ts` now re-exports `OpenClawPluginApi`, `PluginLogger`, `PluginRuntime`, `SubagentRunParams`, `SubagentRunResult` from `openclaw/plugin-sdk` instead of shipping hand-rolled equivalents.
- `openclaw` added as a `peerDependency` at `>=2026.3.24-beta.2`.

### Fixed
- Plugin now actually loads and registers hooks inside a live OpenClaw runtime (previous versions referenced APIs that don't exist).

## [0.1.0] - 2026-04-20

Initial public release.

### Added
- `autoquality-claw` OpenClaw plugin implementing a deterministic post-turn review/fix loop.
- `reply_dispatch` hook intercepts the final reply, runs the loop, then delivers.
- `after_tool_call`, `subagent_spawned`, `subagent_ended` hooks to track edits across the main run and spawned subagents.
- Gatekeeper LLM decides approve / review / fix / stop based on workspace `review-rules.md`.
- Reviewer + fixer subagents configurable by `reviewerAgentId` / `fixerAgentId` / model overrides.
- Loop termination on approval, stop decision, `maxIterations`, no-progress detection, or abort.
- Compact autoquality-claw summary appended to the final user reply when review activity occurred or a limit was hit.
- `runtime.getGatekeeperLlm()` inheritance: if the host OpenClaw provides an LLM client (Bedrock, Mantle, OpenAI, Anthropic), the plugin uses it automatically. Falls back to a direct Anthropic SDK client only when no host client is exposed.
- `configSchema` for all tunables (`rulesPath`, `gatekeeperModel`, `defaultReviewerModel`, `defaultFixerModel`, `maxIterations`, `loopTimeoutSeconds`, `subagentRunTimeoutSeconds`, `emitLivenessUpdates`, `mutatingTools`, ...).
- GitHub Actions CI: install → typecheck → test → build on Node 20 + 22.
- GitHub Actions release workflow: tag push (`v*`) packs the tarball and publishes a GitHub Release.
- Supply-chain quarantine at install time (`scripts/check-package-age.mjs`, 7-day min release age).
- Example `review-rules.md` under `examples/`.
- MIT LICENSE.

[0.1.0]: https://github.com/inceptionstack/autoquality-claw-plugin/releases/tag/v0.1.0
