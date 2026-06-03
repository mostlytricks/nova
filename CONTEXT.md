# CONTEXT — local-llmstxt-server

Last touched: 2026-06-04

## Completed
- **Mission + roadmap reset** (2026-06-04, uncommitted). Added `MISSION.html` as the durable mission doc and expanded `IMPLEMENTATION_PLAN.md` into an 8-phase control-plane roadmap. `CLAUDE.md` now links the doc pipeline. Active arc is Phase 1: namespace docs-split CLI.
- **Doc standardize** (2026-06-03, uncommitted). Renamed `modifycation-plan--docs-split.md` → **`IMPLEMENTATION_PLAN.md`** (typo fix + standard slot so `/triage`+`/mission` see it) via `git mv`; updated the 3 references in CLAUDE.md + CONTEXT.md. Doc-ownership audit otherwise clean — README (product usage) / CLAUDE (agent identity) / `docs/agent-guide.md` (importer spec) / IMPLEMENTATION_PLAN (split feature) each own a distinct concern; no collisions to fix.
- CLAUDE.md filled in from real project state (was template stencil) — stack, run/test, entry points, gotchas. Drafted by the workspace-level analysis pass on 2026-05-30.

## Current State
- Runs locally via `pnpm dev` (UI on 5173, API on 3000). `pnpm typecheck` is the only verification command available — no tests.
- Git: 2 commits on `master` (`init`, `git ignore`), tracking `origin/master` at github.com/mostlytricks/local-llmstxt-server. Working tree has doc changes in flight.
- `IMPLEMENTATION_PLAN.md` at the repo root is now the coworking roadmap. Phase 1 is the in-flight docs-split CLI; read it before touching `data/own/` layout or namespace routes.
- SQLite at `data/index.sqlite` is live (WAL files present), so the scheduler has run at least once.

## Next Step
- Finish and verify **Phase 1 — Namespace Docs-Split CLI** in `server/bin/docs-import.ts`.
- After Phase 1 lands: run `pnpm typecheck`, exercise `pnpm docs-import split <namespace> --dry-run`, and update this file with results.

---

<!-- Notes:
- No formatter/linter configured — don't introduce one without asking.
- Default branch is `master`, not `main`. Per-PR commands need to use the right base.
-->
