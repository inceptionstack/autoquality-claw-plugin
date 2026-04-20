# Codex Implementation Brief

## Goal
Implement the `auto-claw` plugin exactly per `docs/PLAN.md` as a **standalone repo** at `inceptionstack/autoquality-claw-plugin`.

## Critical adaptations (because this is NOT the openclaw monorepo)

The plan assumes `extensions/auto-claw/` inside an openclaw monorepo with pnpm workspaces. This repo is standalone. Apply these overrides:

1. **All source paths are at repo root**, NOT under `extensions/auto-claw/`.
   - `src/` at root
   - `test/` at root
   - `examples/` at root
   - `docs/` at root (already exists)
2. **package.json** — make it standalone:
   - name: `@inceptionstack/auto-claw-plugin` (public publishable)
   - NO `peerDependencies: { "openclaw": "workspace:*" }` — remove it
   - Use `npm` not `pnpm`
   - Scripts: `build`, `test`, `test:watch`, `typecheck`, `lint` (use tsc --noEmit for typecheck; no ESLint needed)
3. **tsconfig.json** — standalone, not extending `../../tsconfig.base.json`. Use strict, ESNext, NodeNext moduleResolution.
4. **SKIP Task 15 entirely** (monorepo wiring). Instead add a README with install instructions.
5. **Task 14 integration test** — keep but run via `npm test`.
6. Commands in plan say `pnpm test`; use `npm test` instead.

## Engineering principles (non-negotiable)
- **TDD loop per task**: write failing test → confirm fail → implement → confirm pass → commit. The plan already specifies this; follow it literally.
- **DRY**: no duplicated helpers. If two files need the same helper, extract to a shared module.
- **Clean Code**: names describe intent, functions <40 lines unless justified, no dead code, no TODO/FIXME left behind.
- **Strict TypeScript**: `strict: true`, no `any` in new code (the LLM SDK boundary can use `as any` sparingly — isolate to `llm.ts`).
- **Error handling at boundaries**: validate external input (file reads, env vars, LLM responses); internal calls can trust each other.
- **No secrets in code**: API keys come from env (`ANTHROPIC_API_KEY` via config).
- **Every commit runs clean**: tests pass, typecheck passes.

## Repo hygiene already in place
- `.gitignore` (node_modules, dist, etc.)
- `.npmrc` with `min-release-age=7` (supply-chain quarantine — DO NOT remove)
- git-secrets hooks installed + AWS patterns registered
- Git identity set to `Roy Osherove <575051+royosherove@users.noreply.github.com>`

## After all tasks done
1. Run `npm run build && npm test` — all must pass.
2. Write a `README.md` at repo root covering: what it is, install, config, example `review-rules.md`, how to enable in openclaw.
3. Do a final self-review pass: re-read every `src/*.ts` and check for duplication (DRY), dead code, untested branches, `any` leaks outside `llm.ts`. Write findings to `docs/SELF_REVIEW.md` and fix anything actionable before final commit.
4. Final commit: `chore: self-review pass, README, ready for review`.
5. Push to `main` (token is in git credential.helper already).

## Plan location
Full authoritative plan: `docs/PLAN.md` (2689 lines). Follow Tasks 0 through 16. Adapt paths per the overrides above.

## When done
Run:
```
openclaw system event --text "Done: auto-claw plugin built in inceptionstack/autoquality-claw-plugin — all tests green, self-review complete" --mode now
```
