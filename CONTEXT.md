# CONTEXT — local-llmstxt-server

Last touched: 2026-06-21

## Completed
- **Docs moved to `.gravity/` (doc-system adoption)** (2026-06-21, **uncommitted**). Relocated the heavy docs out of the repo root into `.gravity/`, grouped by domain: top-level `MISSION.html` / `ARCHITECTURE.html` / `IMPLEMENTATION_PLAN.md`, plus `ingest/SPEC.md` (was `SPEC.ingest-router.md`) and `namespace/SPEC.md` (was `SPEC.dev-docs-llms-txt.md`). `CLAUDE.md` + `CONTEXT.md` + `README.md` stay at root; `CLAUDE.md` is now the **router** (Doc Map + read-first table + domain gate). `MISSION.html` gained a §05 "two domains" section; `IMPLEMENTATION_PLAN.md` gained a per-domain status spine. All skill/doc cross-refs repathed. Per workspace CLAUDE.md §6 — see the `CLAUDE.md` Doc Map.
- **Ingestion router + CSR/SPA handling — Track R complete locally** (2026-06-20, **uncommitted**). `probe` now returns `rendering: 'ssr'|'csr'` + `mdTwin` (pre-rendered markdown twin): `detectCsr` flags client-side rendering from empty mount container / low-text+scripts (markers only corroborate, so SSG with embedded content is not a false positive), and `findMdTwin` discovers `/page.md` shortcuts. Added `SPEC.ingest-router.md` (the input→lane front door + 3-rung SPA ladder: twin → render → operator paste) and wired both skills to it. Added opt-in `pnpm docs-import fetch-clean <url> --render` with lazy Playwright Chromium, optional `--wait-for <selector>`, shared `htmlToMarkdown(html, url)`, and graceful missing-dep/browser guidance. Proved `llms-compose` by composing the local Track R specs into `data/own/ingestion-router/`; `pnpm docs-import check ingestion-router` reports healthy. Verified: `pnpm typecheck` clean; live probe of `fastify.dev` stays `ssr`; a local SPA-shell server correctly reports `csr` + finds/omits the twin with the right fallback warning; local CSR render smoke test produced cleaned markdown from the rendered DOM.
- **Authoring contract + composer skill** (2026-06-20, **uncommitted — in working tree**). Wrote `SPEC.dev-docs-llms-txt.md` (repo root) — the agent-loadable requirements + quality gate for *dev/API* `llms.txt` namespaces (manifest/entry rules, dev-API specifics like base-URL/auth-once, the required-metadata gap list, "don't invent — ask"). Added `.claude/skills/llms-compose/SKILL.md` — composes a namespace from *arbitrary local material the agent reads itself* (pptx/clipboard/PDF/text/local files) via a batched metadata interview; defers to the SPEC on all rules. Dry-run completed against local Track R specs.
- **Agent endpoint alignment** (2026-06-20, **uncommitted**). Added explicit agent-facing endpoints so operators do not have to explain `?merge=true`: `GET /agent/llms.txt` is now the recommended merged manifest (local master + active trusted external sources), `GET /agent/namespaces` lists local namespace manifests, `GET /agent/sources` lists active external sources with per-source manifest URLs, and `GET /agent/sources/:id/llms.txt` serves one active external source as a focused manifest. `/api/agent/index` and the Agent View now advertise these URLs. `GET /llms.txt?merge=true` still works as a legacy merged view.
- **Feasibility review vs new mission** (2026-06-20). Confirmed fit: UC1 (cache an external `llms.txt` like litellm → serve on intranet) and the swagger/webpage half of UC2 are **already built**; the pptx/clipboard half was the only gap, now covered by `llms-compose`. New open problem surfaced: input can be **CSR/SPA webpages** that `fetch-clean` (static HTML → Readability) can't render.
- **Phases 1-7 shipped** (through 2026-06-07, **committed & pushed**, head `80b631c`). Docs-split CLI, health checks, dashboard signals, agent view, trust metadata, refresh history, write protection. Earlier CONTEXT calling these "uncommitted" was stale — they landed in `a1ffaa5`/`80b631c`.

## Current State
- Runs locally via `pnpm dev` (UI 5173, API 3000). `pnpm typecheck` passes clean (server + UI). No tests.
- Git: **8 commits on `master`, even with `origin/master`**. Working tree is uncommitted: the Track R + agent-endpoint code (`server/bin/docs-import.ts`, `server/fetcher/fetch.ts`, `package.json`, `pnpm-lock.yaml`, `README.md`), the `llms-compose` skill + `docs-import` skill edits, and the new **`.gravity/` doc reorg** (docs moved out of root via `git mv`; SPECs now at `.gravity/{ingest,namespace}/SPEC.md`).
- CSR/SPA strategy decided = **ladder** (twin → headless render → operator paste). Track R implementation is complete locally and ready to commit.
- `.gravity/IMPLEMENTATION_PLAN.md` Phase 8 (Search) is still the unstarted roadmap arc and becomes the next implementation target after committing the current Track R + endpoint alignment slice.

## Next Step
- Commit the whole ingestion-router + agent endpoint alignment slice, then start **Phase 8 — Search**.

---

<!-- Notes:
- No formatter/linter configured — don't introduce one without asking.
- Default branch is `master`, not `main`.
- `llms-compose` is DRAFT until dry-run on a real deck/page.
-->
