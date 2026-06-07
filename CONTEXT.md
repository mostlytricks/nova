# CONTEXT — local-llmstxt-server

Last touched: 2026-06-07

## Completed
- **Basic write protection** (2026-06-07, **uncommitted — in working tree**). Added `WRITE_TOKEN` (config) + a shared guard `requireWriteAccess` in the new `server/write-protect.ts`, called at the top of every mutating handler in `routes/{entries,llms,sources}.ts` (per-handler, not a global hook). Verified with `pnpm typecheck`, `pnpm build`, a `401` on anonymous `PUT /api/entries`, and `200` with `Authorization: Bearer phase7-token`.
- **Snapshot and refresh history** (2026-06-07, **uncommitted — in working tree**). Added source/link refresh history tables, preserved link IDs during source manifest reconciliation, recorded refresh attempts and content-change snapshots, and surfaced read-only history on `GET /api/sources/:id/history` and `GET /api/links/:id/history` plus the source detail UI. Verified with `pnpm typecheck`, `pnpm build`, and live endpoint checks against source `2`. → Walkthrough (covers this + trust metadata): `docs/walkthroughs/2026-06-07-trust-metadata-and-refresh-history.md`.
- **Trust metadata for external sources** (2026-06-06, **uncommitted — in working tree**). Nullable source trust fields (`owner`, `trust_note`, `intended_use`, `warning`, `last_reviewed_at`, `promotion_reason`), startup schema migration, source API patch/create support, promotion-reason prompt, source detail editors, dashboard trust summary, agent-index trust fields. Verified nullable existing rows, reversible PATCH, `/api/agent/index`, `pnpm typecheck`, and `pnpm build` when the work was done.
- **Read-only agent view + health signals** (2026-06-04→06, **committed & pushed**, `6b6b9c4`). `GET /api/agent/index` + `/agent` UI (copyable master/merged/namespace URLs), read-only health API + dashboard/sidebar badges, shared `server/health.ts`, and `pnpm docs-import check <ns> | --all | --json`.
- **Docs-split CLI + mission/roadmap reset** (2026-06-04, **committed & pushed**, `0a3a02e`/`3477bce`). `pnpm docs-import split <ns>` (`--by sections|path|manual`, `--dry-run`); added `MISSION.html` and expanded `IMPLEMENTATION_PLAN.md` into the 8-phase control-plane roadmap; renamed the old split-plan file into the standard `IMPLEMENTATION_PLAN.md` slot.

## Current State
- Runs locally via `pnpm dev` (UI on 5173, API on 3000). `pnpm typecheck` + `pnpm build` are the only verification (no tests).
- Git: **5 commits on `master`, even with `origin/master` (all pushed)** at github.com/mostlytricks/local-llmstxt-server. Working tree has **three features in flight, uncommitted** — the trust-metadata changes, the new refresh-history changes, and basic write protection plus in-progress doc edits.
- `IMPLEMENTATION_PLAN.md` Phases 1-7 are implemented; Phase 8 (Search) is the next arc.
- SQLite at `data/index.sqlite` is live (WAL files present), so the scheduler has run at least once.

## Next Step
- Commit the in-flight **trust-metadata**, **refresh-history**, and **basic write protection** features, then begin **Phase 8 — Search**.

---

<!-- Notes:
- No formatter/linter configured — don't introduce one without asking.
- Default branch is `master`, not `main`. Per-PR commands need to use the right base.
-->
