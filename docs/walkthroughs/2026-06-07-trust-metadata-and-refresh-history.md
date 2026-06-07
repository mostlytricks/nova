# Walkthrough — Trust metadata + snapshot/refresh history

> Closes: **Phase 5** (Trust Metadata For External Sources) and **Phase 6** (Snapshot And Refresh History) of `IMPLEMENTATION_PLAN.md`.
> Date: 2026-06-07 · Branch `master` · Commit: **uncommitted — in working tree** (this walkthrough precedes the commit).

## What changed

Two slices of the source control plane shipped together: external sources now carry **explicit trust metadata**, and every refresh is **recorded with content snapshots** so operators can see upstream drift.

**Phase 5 — trust metadata**
- **[MODIFY]** `server/db.ts` — added nullable source trust columns (`owner`, `trust_note`, `intended_use`, `warning`, `last_reviewed_at`, `promotion_reason`) via a startup schema migration; existing rows stay valid (NULL).
- **[MODIFY]** `server/routes/sources.ts` — create/PATCH accept the new fields; promotion (trial → active) prompts for a `promotion_reason`.
- **[MODIFY]** `server/routes/agent.ts` — `/api/agent/index` now exposes trust fields for active external sources.
- **[MODIFY]** `ui/components/SourceView.tsx` — source-detail trust editors + "last reviewed" display.
- **[MODIFY]** `ui/components/Dashboard.tsx` — trust summary on the dashboard.

**Phase 6 — snapshot & refresh history**
- **[MODIFY]** `server/db.ts` — added source/link refresh-history tables.
- **[MODIFY]** `server/fetcher/source.ts` — preserves link IDs across manifest reconciliation, records each refresh attempt, and snapshots normalized markdown when content changes (the bulk of the change, +258 lines).
- **[MODIFY]** `server/routes/sources.ts` — read-only `GET /api/sources/:id/history` and `GET /api/links/:id/history`.
- **[MODIFY]** `ui/components/SourceView.tsx`, `ui/api.ts`, `ui/styles.css` — surface refresh history in the source detail UI.

Diff: **11 files, +796 / −62** (code: `server/db.ts` +107, `server/fetcher/source.ts` +258, `server/routes/sources.ts` +92, `ui/components/SourceView.tsx` +185, `ui/api.ts` +54, `ui/styles.css` +73, `server/routes/agent.ts` +6, `ui/components/Dashboard.tsx` +9; remainder is docs).

## How it was verified

```bash
$ pnpm typecheck
> tsc -p tsconfig.server.json --noEmit && tsc -p tsconfig.ui.json --noEmit
# clean — no errors (both server + UI tsconfigs)

$ pnpm build
> vite build && tsc -p tsconfig.server.json
✓ 201 modules transformed.
../dist/ui/index.html                  0.41 kB │ gzip:  0.27 kB
../dist/ui/assets/index-*.css          7.81 kB │ gzip:  2.01 kB
../dist/ui/assets/index-*.js         292.18 kB │ gzip: 90.42 kB
✓ built in 954ms
# server tsc emitted with no errors
```

- [x] **Typecheck** (server + UI) — clean.
- [x] **Production build** — Vite bundled 201 modules; server `tsc` clean.
- [x] **Nullable migration** — existing source rows load with NULL trust fields (verified when the work was done).
- [x] **Reversible PATCH** — all six trust fields round-trip via `PATCH /api/sources/:id`.
- [x] **History endpoints** — `GET /api/sources/:id/history` and `GET /api/links/:id/history` return refresh records (live-checked against source `2`).
- [x] **Agent index** — `/api/agent/index` includes trust metadata for active sources.

> No automated tests exist in this repo (per `CLAUDE.md`); `pnpm typecheck` + `pnpm build` + manual endpoint checks are the gate.

## Outcome

External sources are now self-describing for trust (who added it, why it's trusted, how to use it, warnings, last review) and self-auditing for change (every refresh attempt + content snapshot is recorded and inspectable read-only). The control plane can now answer "should an agent trust this source?" and "what changed upstream and when?" — the foundation the later write-protection and search phases build on.

## Follow-ups / known gaps

- **Rollback is deferred.** Phase 6 shipped read-only history only; restoring a prior snapshot is a later slice.
- **No write protection yet** — these new mutating endpoints (PATCH trust, etc.) are still open. That's exactly **Phase 7 — Basic Write Protection** (next).
- Commit these two features (this walkthrough documents the pre-commit state); `CONTEXT.md` "Completed" should link here rather than restate.
