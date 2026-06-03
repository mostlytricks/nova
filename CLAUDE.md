# local-llmstxt-server

Internal-network server that hosts your own `llms.txt` (with namespaced sub-manifests) and acts as a probe/cache/relay for external `llms.txt` sources. React UI for editing own content, probing new external sources, and managing source lifecycle (trial → active → archived).

---

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

- **Branch / commit style:** repo has only two commits (`init`, `git ignore`) — no established convention yet. Use imperative one-liners until something is set.
- **Formatter / linter:** none configured. Don't introduce one without asking.
- **Code layout:**
  - `server/index.ts` — Fastify entry, registers routes + starts the scheduler.
  - `server/routes/{llms,sources,entries,content,stats}.ts` — one file per route group. New endpoints go in the file whose prefix matches; create a new file + `register…Routes` call in `index.ts` for a new top-level area.
  - `server/fetcher/{fetch,scheduler,source}.ts` — background TTL-driven refresh of external sources.
  - `server/{config,db,own,parser}.ts` — config (host/port/paths), SQLite handle, own-content helpers, llms.txt parser.
  - `ui/components/*.tsx` — one component per file; `App.tsx` wires them; `api.ts` is the typed fetch wrapper.
- **ESM imports use `.js` extensions** on local files (e.g. `'./db.js'`) even though sources are `.ts`. Required by Node's ESM resolver under `"type": "module"`.

## Constraints & Gotchas

- **Node 22 LTS is the floor.** Older Node will fail on top-level await in `server/index.ts`.
- **No auth.** Write endpoints (edit own entries, add/remove sources) are open. Do not expose to the public internet.
- **`data/cache/` and `data/index.sqlite` are regenerable** — fine to delete during debugging. `data/own/` is the source of truth and should be git-tracked once you have content worth keeping.
- **White page at `localhost:5173`** typically means a stale `node` is holding the port and Vite quietly bound to `5174`. README has the kill-port recipe.
- **`.claude/` directory at the repo root** holds local Claude Code config — already covered by `.gitignore`.
- **`IMPLEMENTATION_PLAN.md`** at the repo root is the build plan for the in-flight docs-split refactor. Read before changing how docs are split across namespaces.

## Entry Points

- **Server boot:** `server/index.ts`.
- **Route layer:** `server/routes/*.ts` — pick by URL prefix.
- **UI entry:** `ui/main.tsx` → `ui/App.tsx`.
- **Frontend ↔ backend contract:** `ui/api.ts` (typed fetch helpers, must stay in sync with `server/routes/*.ts`).
- **Background work:** `server/fetcher/scheduler.ts`.
- **Pipeline docs** (each owns one concern; link rather than restate — workspace CLAUDE.md §6):
  - `MISSION.html` — the durable *why*: north star, product principles, the architecture seam (§04 "originals immutable; namespaces are views"), and current non-goals.
  - `IMPLEMENTATION_PLAN.md` — the *what/next*: the in-flight namespace docs-split build arc.
  - `CONTEXT.md` — the rolling *now*: current state + the single next step.

## Git

- Remote: `https://github.com/mostlytricks/local-llmstxt-server.git`
- Default branch: `master` (not `main`).
