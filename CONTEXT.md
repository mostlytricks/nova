# CONTEXT — local-llmstxt-server (`nova`)

Last touched: 2026-07-11

## Completed
- **Gravity v1.8 sync + Tracks formalized** (2026-07-11). Synced to gravity v1.8 — added `.gravity/GRAVITY.md` protocol card, bumped stamp v1.0→v1.8 (committed `61028a3`, pushed). Then formalized the hand-rolled Track R/M into the canonical v1.8 **Tracks index** in `IMPLEMENTATION_PLAN.md`: **Track R** (input hardening) retired → residue in `ingest/SPEC.md` + `namespace/SPEC.md`; **Track M** (intranet deployment) active, detail moved down into new `.gravity/ingest/PLAN.intranet-mirror.md`.
- **Phase 8 Search re-built** (2026-07-06). Shared core `server/search.ts` (case-insensitive AND-term ranking over own entries + namespace manifests + cached active-source metadata & body) feeding two callers: `GET /api/search?q=&limit=` (`server/routes/search.ts`) and `docs-import search <q> [--json] [--limit N]`. Source-page result URLs reuse `routes/docs.ts` `sourcePageNames` so they match `/docs/` serving. Verified end-to-end: typecheck clean, CLI + API return ranked results, top result URL served 200. (Replaces the impl lost in the pull.)
- **`nova` alias + gravity housekeeping** (2026-07-06). Declared `> alias: nova` (*Namespace Orchestrator for Verified Agent-docs*) in `CLAUDE.md`; restored the `> gravity: v1.0` stamp the pull had dropped; gave `ingest/SPEC.md` and `namespace/SPEC.md` explicit `**Gate:**` lines. Track M6 + M7 (clean `/docs/` URLs, reader + review UI) had merged to `master` via PRs #1-#2.

## Current State
- Runs locally via `pnpm dev` (UI 5173, API 3000). `pnpm typecheck` passes clean. No tests.
- Git: `master`, pushed to `origin` through the gravity-sync commit; the Tracks-formalization commit is local (push pending). Working tree clean.
- Docs: on gravity **v1.8** (protocol card + stamp). `IMPLEMENTATION_PLAN.md` now carries a **Tracks index** (direction axis) beside the domain spine; active Track M detail lives in `.gravity/ingest/PLAN.intranet-mirror.md`.
- Shipped: Phases 1–8 + Track R (ingest router / CSR ladder, now retired) + Track M1/M2/M6/M7. `?resolve=local` serves cached external docs to offline intranet agents. M3 external mirror **validated in sandbox** (163/163), not yet on the real host.
- **Phase 8 Search is API + CLI only** — not yet surfaced in the UI or the `llms-txt-reader` skill. That's the natural follow-up once it's exercised in anger.

## Next Step
- **Track M3 on the real intranet host:** repeat the sandbox-validated external mirror on the real host + offline acceptance test from a second machine (`NODE_USE_ENV_PROXY=1` + `NODE_EXTRA_CA_CERTS` if egress goes through a proxy). Then Track M4 (first internal pptx/excel manual through the `llms-compose` checkpoint flow).

---

<!-- Notes:
- No formatter/linter configured — don't introduce one without asking.
- Default branch is `master`, not `main`.
- `llms-compose` passed its local dry-run; first *real* deck/excel run is Track M4.
- Phase 8 Search: API + CLI only; surfacing it in the UI / `llms-txt-reader` is the follow-up.
-->
