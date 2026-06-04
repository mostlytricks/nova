# CONTEXT — local-llmstxt-server

Last touched: 2026-06-04

## Completed
- **Dashboard health signals** (2026-06-04, uncommitted). Added read-only health API routes, typed UI fetch helpers, namespace health merge in `App.reload`, dashboard aggregate/card badges, and sidebar unhealthy markers. Verified API endpoints, `pnpm typecheck`, and `pnpm build`. Browser visual verification could not run because no in-app browser backend was available.
- **Namespace health checks** (2026-06-04, uncommitted). Added shared `server/health.ts` plus `pnpm docs-import check <namespace>`, `check --all`, and `--json`. Verified healthy, broken, JSON, and large-namespace split-recommendation flows. Temporary health fixtures were removed after verification.
- **Namespace docs-split CLI** (2026-06-04, uncommitted). Added `pnpm docs-import split <namespace>` with `--by sections|path|manual`, `--dry-run`, generated sibling namespaces, copied own entries, and split index generation. Verified with temporary fixtures and `demos --dry-run`.
- **Mission + roadmap reset** (2026-06-04, uncommitted). Added `MISSION.html` as the durable mission doc and expanded `IMPLEMENTATION_PLAN.md` into an 8-phase control-plane roadmap. `CLAUDE.md` now links the doc pipeline.
- **Doc standardize** (2026-06-03, uncommitted). Renamed `modifycation-plan--docs-split.md` → **`IMPLEMENTATION_PLAN.md`** (typo fix + standard slot so `/triage`+`/mission` see it) via `git mv`; updated the 3 references in CLAUDE.md + CONTEXT.md. Doc-ownership audit otherwise clean — README (product usage) / CLAUDE (agent identity) / `docs/agent-guide.md` (importer spec) / IMPLEMENTATION_PLAN (split feature) each own a distinct concern; no collisions to fix.
- CLAUDE.md filled in from real project state (was template stencil) — stack, run/test, entry points, gotchas. Drafted by the workspace-level analysis pass on 2026-05-30.

## Current State
- Runs locally via `pnpm dev` (UI on 5173, API on 3000). `pnpm typecheck` is the only verification command available — no tests.
- Git: 2 commits on `master` (`init`, `git ignore`), tracking `origin/master` at github.com/mostlytricks/local-llmstxt-server. Working tree has doc changes in flight.
- `IMPLEMENTATION_PLAN.md` at the repo root is now the coworking roadmap. Phases 1-3 are implemented; next arc is Phase 4 read-only agent view.
- SQLite at `data/index.sqlite` is live (WAL files present), so the scheduler has run at least once.

## Next Step
- Start **Phase 4 — Read-Only Agent View** with a simple API/UI surface listing the master manifest, namespace manifests, split indexes, and suggested copyable agent URLs.

---

<!-- Notes:
- No formatter/linter configured — don't introduce one without asking.
- Default branch is `master`, not `main`. Per-PR commands need to use the right base.
-->
