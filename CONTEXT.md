# CONTEXT — local-llmstxt-server (`nova`)

Last touched: 2026-07-06

## Completed
- **Track M6 + M7 merged to `master`** (PRs #1 & #2, 2026-07-03). M6: clean per-doc `/docs/<name>/` URLs for local namespaces *and* mirrored sources, with stable source slugs (`server/routes/docs.ts`, `server/slug.ts`). M7: reader-mode doc-site view (`ui/components/ReaderView.tsx`), review panel with Mark-reviewed / Promote (`ui/components/ReviewPanel.tsx`), `link_missing_description` lint, `remark-gfm` tables. PR #2 recorded the M3 mirror pilot (`code.claude.com`, 163/163 cached) + egress-proxy setup.
- **`nova` alias + gravity housekeeping** (2026-07-06). Declared `> alias: nova` (*Namespace Orchestrator for Verified Agent-docs*) in `CLAUDE.md`; restored the `> gravity: v1.0` stamp the pull had dropped; gave `ingest/SPEC.md` and `namespace/SPEC.md` explicit `**Gate:**` lines (spec-honesty checker was warning `GATE_MISSING`).

## Current State
- Runs locally via `pnpm dev` (UI 5173, API 3000). `pnpm typecheck` passes clean. No tests.
- Git: `master` (pushed through `b13d61d`); the whole Track M slice is now committed — the long-standing "pending commit" state is resolved. Working tree holds only this housekeeping slice.
- Shipped: Phases 1–7 + Track R (ingest router / CSR ladder) + Track M1/M2/M6/M7. `?resolve=local` serves cached external docs to offline intranet agents. M3 external mirror **validated in sandbox** (163/163), not yet on the real host.
- **Phase 8 (Search) does not exist.** A prior *uncommitted* Search implementation (`server/search.ts`, `server/routes/search.ts`, `docs-import search`) was lost when the git pull reconciled the working tree — no stash, no branch, unrecoverable from git. It must be re-implemented from the `IMPLEMENTATION_PLAN.md` Phase 8 spec.

## Next Step
- **Track M3 on the real intranet host:** repeat the sandbox-validated external mirror on the real host + offline acceptance test from a second machine (`NODE_USE_ENV_PROXY=1` + `NODE_EXTRA_CA_CERTS` if egress goes through a proxy). Then Track M4 (first internal pptx/excel manual through the `llms-compose` checkpoint flow).

---

<!-- Notes:
- No formatter/linter configured — don't introduce one without asking.
- Default branch is `master`, not `main`.
- `llms-compose` passed its local dry-run; first *real* deck/excel run is Track M4.
- Phase 8 Search was lost pre-pull — re-implement, don't assume it exists.
-->
