# local-llmstxt-server

Internal-network server that hosts your own `llms.txt` (with namespaced sub-manifests) and acts as a probe/cache/relay for external `llms.txt` sources. React UI for editing own content, probing new external sources, and managing source lifecycle (trial → active → archived).

> **alias:** `nova` — *Namespace Orchestrator for Verified Agent-docs*; the project's declared short name, resolved by gravity tooling (`.claude/scripts/resolve_project.py`). Owned here, per project.
>
> **gravity: v1.8** · This project uses the workspace `.gravity/` doc system. `CLAUDE.md` is the root router, `CONTEXT.md` owns now, and `.gravity/` owns the durable why / what-next / how-it-is-built docs.

---

## Doc Map (`.gravity/`)

> This `CLAUDE.md` (identity, *how*) + `CONTEXT.md` (*now*) stay at the root and auto-load; `README.md` is the user guide. The *why / what-next / how-it's-built* live under **`.gravity/`**, organized by subject domain. One concern, one owner — link, don't restate. Precedence on conflict: CONTEXT (now) > CLAUDE (how) > PLAN (next) > MISSION (why).

```
.gravity/
  MISSION.html              # why — north star, principles, non-goals, the §04 "immutable originals; namespaces are views" seam (browser-read)
  ARCHITECTURE.html         # how — operator/agent system map: roles, ingestion paths, namespace shape, serving URLs, trust/state (browser-read)
  IMPLEMENTATION_PLAN.md    # what/next — the 8-phase control-plane roadmap + per-domain status spine
  ingest/     SPEC.md       # front door: any input → which ingestion lane (docs-import vs llms-compose), the CSR/SPA ladder
  namespace/  SPEC.md       # output contract: what a good dev/API llms.txt namespace must satisfy
```

`docs/walkthroughs/*.md` — dated, append-only proof-of-work for shipped slices (CONTEXT.md "Completed" links here).

## What to read before a change (router)

Before touching a domain, load its `.gravity/<domain>/SPEC.md` — the compact agent contract. `ARCHITECTURE.html` is the human reference behind it (read for the full rationale).

| If you're changing… | Read first | Human reference |
|---|---|---|
| ingest routing — input → lane, the probe contract, the CSR/SPA ladder | `.gravity/ingest/SPEC.md` | `.gravity/ARCHITECTURE.html` §03 |
| what a produced `llms.txt` namespace must satisfy (manifest/entry rules, API auth-once, "don't invent — ask") | `.gravity/namespace/SPEC.md` | `.gravity/ARCHITECTURE.html` §04 |

**Skills are the procedures; the two SPECs are the contracts they obey** — read the matching SPEC before running a skill. **Front door:** `.gravity/ingest/SPEC.md` decides which lane handles a given input (URL vs local material vs CSR/SPA), including the 3-rung ladder (markdown twin → headless render → operator paste). A login/CA-walled page is a fourth path: `cookie-extract` + `windows-ca-web-fetch` get the bytes, then a producer skill ingests them.

| Skill | Role | Use when |
|---|---|---|
| `docs-import` | **Producer** (URL lane) | Input is a fetchable URL — doc site, OpenAPI/Swagger, an existing `llms.txt`. The project CLI fetches/parses; agent makes editorial calls. |
| `llms-compose` | **Producer** (local lane) | Input is local material the agent reads itself — pptx, PDF, pasted/clipboard text, local files — *or* a CSR/SPA URL the CLI couldn't render. Centers on a metadata interview that **asks, never invents**. |
| `llms-txt-reader` | **Consumer** | Grounding an answer in an `llms.txt` manifest (including this server at `localhost:3000`). Fetches the manifest, follows only the relevant links. |
| `cookie-extract` | **Protected-source fetch** | A target page sits behind a login/SSO. HITL: opens a headed browser, user logs in, extracts session cookies. Uses Playwright (same dep family as the render rung). |
| `windows-ca-web-fetch` | **Protected-source fetch** | A URL needs a corporate/private CA bundle, `Authorization` header, or session cookies. Windows `curl.exe` wrapper. Pairs with `cookie-extract` to feed a producer skill. |

## Adding a domain (start here for a new feature)

A **domain** is a durable subject area an agent repeatedly navigates and changes — not every feature is one. Mint a `.gravity/<domain>/` folder only when the feature has its own *gravity* (its own principle + non-goal, rules worth a `SPEC.md`, a multi-step arc). If it fails that gate, it's a `PLAN.*.md` slice under an existing domain (`ingest`/`namespace`), not a new folder. When you do add one, **wire all four indexes so it's never orphaned**: this Doc Map, the router table above, a `.gravity/MISSION.html` "system in N domains" row, and the `.gravity/IMPLEMENTATION_PLAN.md` status spine. Start minimal — usually just `PLAN.md` day one; add `SPEC.md`/`ARCHITECTURE.html` as they earn it. `/new-domain local-llmstxt-server <domain>` does the wiring. (Workspace CLAUDE.md §6.)

## Stack

- **Language / runtime:** TypeScript 5.6, Node **22 LTS** (or newer), `pnpm` 9 (`packageManager` pinned in `package.json`).
- **Framework:** Fastify 4 (API), Vite 5 + React 18 (UI), `tsx` for dev/watch.
- **Key dependencies:** `better-sqlite3` (source/link metadata), `@mozilla/readability` + `jsdom` + `turndown` (HTML → normalized markdown), `@apidevtools/swagger-parser` (probe).
- **Datastore:** SQLite at `data/index.sqlite` (WAL mode; `*-shm` / `*-wal` files alongside). Reproducible from scratch — safe to delete if state corrupts.

## Run

```bash
# install
pnpm install

# dev — server + UI concurrently, with watch
pnpm dev
# UI:  http://localhost:5173  (Vite, proxies /api/ and /llms.txt to 3000)
# API: http://localhost:3000

# production — one server serves UI + API at :3000
pnpm build
pnpm start

# import docs into a namespace (script)
pnpm docs-import
```

Default `HOST=0.0.0.0`; expose on LAN by opening port 3000 on the firewall.

## Test

No tests yet. Verify changes by running `pnpm typecheck` (covers both `tsconfig.server.json` and `tsconfig.ui.json`) and manually exercising the affected route or UI flow.

## Conventions

- **Branch / commit style:** work has gone straight to `master` (now ~8 commits, pushed to `origin`); messages so far are terse, casual one-liners (`init`, `git ignore`, `modified`, `better.`) — no strict convention. Prefer imperative one-liners going forward.
- **Formatter / linter:** none configured. Don't introduce one without asking.
- **Code layout:**
  - `server/index.ts` — Fastify entry, registers routes + starts the scheduler.
  - `server/routes/{llms,sources,entries,content,stats,agent,health}.ts` — one file per route group. New endpoints go in the file whose prefix matches; create a new file + `register…Routes` call in `index.ts` for a new top-level area.
  - `server/fetcher/{fetch,scheduler,source}.ts` — background TTL-driven refresh of external sources.
  - `server/{config,db,own,parser,health,write-protect}.ts` — config (host/port/paths/`WRITE_TOKEN`), SQLite handle, own-content helpers, llms.txt parser, health-check helper, and the shared write-token guard.
  - `ui/components/*.tsx` — one component per file; `App.tsx` wires them; `api.ts` is the typed fetch wrapper.
- **ESM imports use `.js` extensions** on local files (e.g. `'./db.js'`) even though sources are `.ts`. Required by Node's ESM resolver under `"type": "module"`.

## Constraints & Gotchas

- **Node 22 LTS is the floor.** Older Node will fail on top-level await in `server/index.ts`.
- **Optional write token.** When `WRITE_TOKEN` is unset, write endpoints stay open. When it is set, mutating endpoints require `Authorization: Bearer <token>`. The check is a single shared guard — `requireWriteAccess(req, reply)` in `server/write-protect.ts`, called at the top of each mutating handler in `routes/{entries,llms,sources}.ts` (a per-handler guard, **not** a global `onRequest` hook — so a new write endpoint must call it explicitly). Do not expose the API to the public internet.
- **`data/cache/` and `data/index.sqlite` are regenerable** — fine to delete during debugging. `data/own/` is the source of truth and should be git-tracked once you have content worth keeping.
- **White page at `localhost:5173`** typically means a stale `node` is holding the port and Vite quietly bound to `5174`. README has the kill-port recipe.
- **`.claude/` directory at the repo root** holds local Claude Code config — already covered by `.gitignore`.
- **`.gravity/IMPLEMENTATION_PLAN.md`** is the 8-phase control-plane roadmap (Phases 1–7 **done**; Phase 8 = Search queued) plus **Track R** (ingestion router & CSR/SPA handling — complete locally, pending commit). Read before changing how docs are split across namespaces, touching the ingest path, or starting a new phase.

## Entry Points

- **Server boot:** `server/index.ts`.
- **Route layer:** `server/routes/*.ts` — pick by URL prefix.
- **Write guard:** `server/write-protect.ts` (`requireWriteAccess`) — the one place token enforcement lives; every mutating handler calls it.
- **UI entry:** `ui/main.tsx` → `ui/App.tsx`.
- **Frontend ↔ backend contract:** `ui/api.ts` (typed fetch helpers, must stay in sync with `server/routes/*.ts`).
- **Background work:** `server/fetcher/scheduler.ts`.
- **Pipeline docs** (each owns one concern; link rather than restate — workspace CLAUDE.md §6; full layout in the Doc Map above):
  - `.gravity/MISSION.html` — the durable *why*: north star, product principles, the architecture seam (§04 "originals immutable; namespaces are views"), and current non-goals.
  - `.gravity/IMPLEMENTATION_PLAN.md` — the *what/next*: the 8-phase control-plane roadmap (Phases 1–7 done; Phase 8 next) + the per-domain status spine.
  - `CONTEXT.md` — the rolling *now*: current state + the single next step.

## Git

- Remote: `https://github.com/mostlytricks/local-llmstxt-server.git`
- Default branch: `master` (not `main`).
