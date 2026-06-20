# local-llmstxt-server

A small internal-network server that:

- Serves **your own `llms.txt`** (origin) — your library/API index, the canonical thing agents should read first.
- **Relays + caches** external `llms.txt` you want to track. Linked pages (md / html / docs) are fetched and normalized to markdown.
- Web UI to browse, edit, probe new sources, and manage their lifecycle.

> **Who is this for?** Anyone running agents on an internal/personal network who wants a single managed surface telling them "here are my libs, my APIs, and the external docs I trust — go read these."

---

## Setup (once)

Requires Node **22 LTS** (or newer) and `pnpm`.

```bash
pnpm install
```

If you need to import client-side-rendered documentation pages with `pnpm docs-import fetch-clean <url> --render`, install the optional browser binary after dependencies:

```bash
pnpm exec playwright install chromium
```

## Run

**Development** (server + UI with hot reload):

```bash
pnpm dev
```

- UI:  <http://localhost:5173>
- API: <http://localhost:3000>

**Production** (one server serves UI + API):

```bash
pnpm build
pnpm start
# Everything at http://localhost:3000
```

To expose on your LAN, set `HOST=0.0.0.0` (already the default) and open the firewall on port 3000. Point your other machines / agents at `http://<this-host>:3000/llms.txt`.

---

## How agents consume it

Point an agent / tool at **one of these URLs**:

| URL | What it returns |
|---|---|
| `GET /llms.txt` | **Your master llms.txt.** The top-level index — typically links to each namespace's llms.txt. |
| `GET /llms.txt?merge=true` | Master, plus one section per **active** external source. |
| `GET /llms.txt?merge=true&tag=agents` | Same, but only sources tagged `agents`. |
| `GET /<namespace>/llms.txt` | The llms.txt for a specific namespace (e.g. `/auth-system/llms.txt`). Use this for a focused view. |
| `GET /api/entries/get?name=<path>` | A single markdown doc (e.g. `auth-system/jwt.md`). |
| `GET /api/content/:hash` | Normalized markdown for a cached external link. |
| `GET /api/links/:id/content` | Same content, by link id (visible in the UI). |

Example: prime your agent with `curl http://localhost:3000/auth-system/llms.txt` to scope it to just one set.

---

## Day-to-day usage

### 1. Create a namespace for each set of docs

A **namespace** is a folder under `data/own/` with its own `llms.txt` + markdown files. One namespace per project / library / API.

Sidebar → **Namespaces** → `+ Add` → name it (e.g. `auth-system`). This creates `data/own/auth-system/llms.txt` and exposes it at `GET /auth-system/llms.txt`.

### 2. Add docs inside a namespace

Under the namespace in the sidebar → `+ entry` → name like `jwt.md`. Edit in the split-pane editor (raw + live preview). Files land at `data/own/auth-system/jwt.md`.

Link from that namespace's `llms.txt`:

```markdown
## Docs
- [JWT verification](/api/entries/get?name=auth-system/jwt.md): How to verify session tokens
```

### 3. Master llms.txt is your top-level index

Sidebar → **Master / llms.txt**. This is `data/own/llms.txt` — what agents see at `GET /llms.txt`.

You can hand-write it, OR click **Regenerate from namespaces** to auto-build a master that links to every namespace's llms.txt. Regenerating is safe to repeat.

The format follows the [llmstxt.org spec](https://llmstxt.org/): H1 title, blockquote summary, H2 sections, link list.

### 4. Add an external source (probe → trial → active)

Sidebar → **Sources** → `+ Add`:

1. Paste a URL. You can be sloppy — `adk.dev` becomes `https://adk.dev/llms.txt` automatically.
2. Click **Probe**. Server fetches and parses without saving. You see title, summary, section count, raw markdown.
3. Click **Add as trial** if it looks useful, **Cancel** if not.

New sources start in **trial** state. Background scheduler refreshes them on TTL (default 24h), and the link contents get fetched + normalized to markdown.

### 5. Decide its fate

Click the source in the sidebar → header buttons:

- **Promote → active**: included in `?merge=true` output. Pin the ones you actually want agents to see.
- **Archive**: kept on disk, scheduler stops touching it, hidden from default sidebar filter. Restore any time.
- **Remove**: hard delete + tombstone (so you remember you already tried it). Optional reason.
- **Refresh now**: force-fetch immediately.

Per source you can also set: TTL override (e.g. `1` hour for fast-moving APIs), tags (for the `?tag=…` filter), and a free-text "why I added this" note.

### 6. Browse cached content

Source view → click any link in the list → right pane shows the normalized markdown. "Refresh" re-fetches just that link. "Open original" takes you to the source URL.

---

## File layout

```
data/
├── own/                          # source of truth — edit freely, git-track
│   ├── llms.txt                  # master index (links to namespaces)
│   ├── demos/                    # a namespace
│   │   ├── llms.txt              # namespace's own manifest
│   │   ├── overview.md
│   │   └── quick-ref.md
│   └── auth-system/              # another namespace
│       ├── llms.txt
│       └── jwt.md
├── cache/                        # normalized markdown of remote links (sha-keyed, regenerable)
└── index.sqlite                  # source list, lifecycle state, link metadata, tombstones
```

A "namespace" is just a subfolder of `data/own/` that contains an `llms.txt`. Each one is exposed at `/<namespace>/llms.txt`. Loose `.md` files at the top of `data/own/` (not inside a namespace) are still browsable in the UI as "Loose entries" but don't get their own llms.txt route.

`data/cache/` and `data/index.sqlite` are reproducible — safe to delete; everything will refetch.

---

## Source lifecycle states

| State | In `?merge=true`? | Scheduler refreshes? | Notes |
|---|---|---|---|
| `trial` | no | yes | Newly added; on probation. |
| `active` | **yes** | yes | Pinned. The list agents will see. |
| `archived` | no | no | Kept on disk for reference; restorable. |
| _removed_ | n/a | n/a | Gone, but a tombstone row remains in the `tombstones` table. |

---

## TTL & freshness

Default **24h**, with `ETag` / `If-Modified-Since`, so unchanged sources cost almost nothing per refresh.

- Per-source override in the UI (set `ttl_hours = 1` for a hot source, `168` for a stable one).
- Manual **Refresh now** any time.
- Scheduler ticks every 5 min and only refetches sources past their TTL.

---

## Troubleshooting

**White page at `localhost:5173`** — usually a stale `node` process holding the port; Vite then starts on `5174`. Either open the port Vite reports, or:

```bash
# find what's on 5173
netstat -ano | grep ':5173 '
# kill it
powershell.exe -Command "Stop-Process -Id <PID> -Force"
```

**`/api/sources` returns nothing** — you have no sources yet; add one via the UI.

**Add-source fails with "Not a valid llms.txt"** — the URL didn't return parseable llms.txt content. The probe response includes the raw body; check whether the site actually publishes one.

---

## Auth

None. Designed for trusted internal networks. Don't expose this directly to the public internet — there are write endpoints (edit own entries, add/remove sources) with no auth.

---

## Reference: full API

| Method | Path | Body | Purpose |
|---|---|---|---|
| GET | `/llms.txt` | — | master llms.txt |
| GET | `/llms.txt?merge=true[&tag=…]` | — | master + external sources |
| GET | `/:namespace/llms.txt` | — | one namespace's llms.txt |
| GET | `/api/namespaces` | — | list namespaces |
| POST | `/api/namespaces` | `{ name, title?, summary? }` | create |
| DELETE | `/api/namespaces/:name` | — | delete (recursive) |
| GET | `/api/namespaces/:name/llms` | — | raw + parsed |
| PUT | `/api/namespaces/:name/llms` | `{ raw }` | save |
| POST | `/api/llms/own/regenerate` | — | rebuild master from namespaces |
| GET | `/api/sources` | — | list sources |
| GET | `/api/sources/:id` | — | source + its links |
| POST | `/api/sources/probe` | `{ url }` | preview without saving |
| POST | `/api/sources` | `{ url, tags?, notes?, ttl_hours? }` | add (trial) |
| PATCH | `/api/sources/:id` | `{ state?, tags?, notes?, ttl_hours? }` | edit |
| DELETE | `/api/sources/:id` | `{ reason? }` | soft delete + tombstone |
| POST | `/api/sources/:id/refresh` | — | force refresh |
| POST | `/api/links/:id/refresh` | — | refetch one link |
| GET | `/api/links/:id/content` | — | normalized markdown |
| GET | `/api/content/:hash` | — | normalized markdown by hash |
| GET | `/api/entries` | — | list own .md files |
| GET | `/api/entries/get?name=…` | — | read own .md |
| PUT | `/api/entries` | `{ name, content }` | create / overwrite |
| DELETE | `/api/entries?name=…` | — | delete own .md |
| GET | `/api/llms/own` | — | own llms.txt (raw + parsed) |
| PUT | `/api/llms/own` | `{ raw }` | save own llms.txt |
| GET | `/api/tombstones` | — | removed sources log |
