# local-llmstxt-server

Internal-network server that hosts your own `llms.txt` (with namespaced sub-manifests) and acts as a probe/cache/relay for external `llms.txt` sources. React UI for editing own content, probing new external sources, and managing source lifecycle (trial → active → archived).

---

## Docs in this project

<!-- Read top-to-bottom. One concern, one owner — link, don't restate.
     Precedence on conflict: CONTEXT (now) > CLAUDE (how) > PLAN (next) > MISSION (why). -->

- **CONTEXT.md** — start here: current state + the single next step. *Now.*
- **CLAUDE.md** (this file) — stable identity: stack, run/test, entry points, gotchas. *How.*
- **IMPLEMENTATION_PLAN.md** — phases & locked decisions. *What's next* (may lag; CONTEXT wins on "now").
- **MISSION.html** — why it exists, principles, non-goals. *Why* (browser-read).
- **`docs/walkthroughs/*.md`** — dated, append-only proof-of-work records for shipped slices (present: see `docs/walkthroughs/`). *Optional; CONTEXT.md "Completed" links here.*

No `ARCHITECTURE.html` — "how it's built" lives in this file's **Entry Points** section.

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

- **Branch / commit style:** work has gone straight to `master` (now ~5 commits, pushed to `origin`); messages so far are terse, casual one-liners (`init`, `git ignore`, `modified`, `better.`) — no strict convention. Prefer imperative one-liners going forward.
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
- **`IMPLEMENTATION_PLAN.md`** at the repo root is the 8-phase control-plane roadmap (Phases 1–7 are **done**; Phase 8 = Search is next). Read before changing how docs are split across namespaces or starting a new phase.

## Entry Points

- **Server boot:** `server/index.ts`.
- **Route layer:** `server/routes/*.ts` — pick by URL prefix.
- **Write guard:** `server/write-protect.ts` (`requireWriteAccess`) — the one place token enforcement lives; every mutating handler calls it.
- **UI entry:** `ui/main.tsx` → `ui/App.tsx`.
- **Frontend ↔ backend contract:** `ui/api.ts` (typed fetch helpers, must stay in sync with `server/routes/*.ts`).
- **Background work:** `server/fetcher/scheduler.ts`.
- **Pipeline docs** (each owns one concern; link rather than restate — workspace CLAUDE.md §6):
  - `MISSION.html` — the durable *why*: north star, product principles, the architecture seam (§04 "originals immutable; namespaces are views"), and current non-goals.
  - `IMPLEMENTATION_PLAN.md` — the *what/next*: the 8-phase control-plane roadmap (Phases 1–7 done; Phase 8 next).
  - `CONTEXT.md` — the rolling *now*: current state + the single next step.

## Git

- Remote: `https://github.com/mostlytricks/local-llmstxt-server.git`
- Default branch: `master` (not `main`).
