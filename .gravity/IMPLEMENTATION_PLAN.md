# Implementation Plan — agent-ready docs control plane

> Scope: this file is the shared execution plan for agents working on `local-llmstxt-server`.
> Read `MISSION.html` first. The mission is durable; this plan is the phase roadmap.

## Per-domain status (`.gravity/<domain>/`)

The phase roadmap below tracks the *control-plane build*; this table tracks the two doc **domains** (MISSION.html §05). Legend: ✓ shipped/stable · ◑ active · ○ planned.

| Domain | | Where it stands · next |
|---|---|---|
| `ingest` | ◑ | Front-door router + CSR/SPA ladder (Track R) **committed** (`fc009d9`). Contract: `ingest/SPEC.md`. Next: Track M pilots (real external mirror + real internal-manual compose); fold login/CA fourth-path note into the ladder. |
| `namespace` | ✓ | Output contract stable and enforced by `pnpm docs-import check`. Contract: `namespace/SPEC.md`. Next: revisit only as dev/API requirements evolve. |

## Mission Fit

`local-llmstxt-server` should become an intranet documentation control plane for coding agents: one trusted local place where humans curate local docs, internal API notes, and approved external `llms.txt` sources, then expose them as focused, namespaced manifests that agents can fetch selectively.

The active build strategy is staged:

1. Make oversized namespaces usable by splitting them into smaller agent-ready views. **Done in Phase 1.**
2. Add health checks so operators can tell whether docs are valid, stale, broken, or too large. **Done in Phase 2.**
3. Surface those signals in the dashboard and expose a read-only agent entry view.
4. Add trust, history, protection, and search after the retrieval quality loop is solid.

## Non-Negotiable Principles

- **Originals are immutable.** Never mutate `data/own/<ns>/` while producing a split or view.
- **Views are namespaces.** Generated splits are normal sibling namespaces with their own `llms.txt`.
- **Human-curated trust.** External sources never become active automatically.
- **Agent-first retrieval.** Prefer small, focused, validated docs over larger aggregate surfaces.
- **CLI first for core mechanics.** UI can call into later APIs, but the first version should be scriptable and testable from the terminal.
- **No formatter/linter churn.** The repo has no formatter or linter configured; do not introduce one without explicit approval.
- **Verification baseline.** Run `pnpm typecheck` after code changes. Manually exercise the affected CLI/API/UI flow.

## Current Repo Facts

- Runtime: Node 22+, TypeScript, pnpm 9.
- Server: Fastify in `server/index.ts`, routes in `server/routes/*.ts`.
- UI: Vite + React in `ui/`.
- Import CLI: `server/bin/docs-import.ts`.
- Own docs source: `data/own/`.
- Cache and SQLite are reproducible: `data/cache/`, `data/index.sqlite`.
- ESM local imports use `.js` extensions even when the source file is `.ts`.

---

## Phase 1 — Namespace Docs-Split CLI

Status: **implemented 2026-06-04** in `server/bin/docs-import.ts`.

### Goal

Build an opt-in CLI workflow that turns one oversized namespace into focused sibling namespaces without touching the original.

Example:

```bash
pnpm docs-import split langchain --by sections --dry-run
pnpm docs-import split langchain --by sections
```

### File Layout

Before:

```text
data/own/
  langchain/
    llms.txt
    <topic>.md
```

After:

```text
data/own/
  langchain/              # unchanged original
    llms.txt
    <topic>.md
  langchain--core/
    llms.txt
    <topic>.md
  langchain--integrations/
    llms.txt
    <topic>.md
  langchain--split/
    llms.txt              # thin index pointing at all split namespaces
```

`--` is valid under the existing namespace regex.

### CLI Shape

```bash
pnpm docs-import split <namespace> [--by <strategy>] [--plan <file>] [--dry-run]

  <namespace>       existing namespace under data/own/
  --by sections     default; one split per H2 section in <ns>/llms.txt
  --by path         group links by first URL path segment
  --by manual       emit or apply an editable JSON grouping plan
  --plan <file>     required when applying a manual plan
  --dry-run         print proposed groups and counts, write nothing
```

### Strategy: `--by sections`

1. Parse `data/own/<ns>/llms.txt`.
2. Each H2 section becomes one split group.
3. Slug each section title with kebab-case.
4. Resolve duplicate or reserved slugs with numeric suffixes.
5. Write each split as `<ns>--<slug>/llms.txt`.
6. Rewrite own-entry links:
   - from `/api/entries/get?name=<ns>/<file>.md`
   - to `/api/entries/get?name=<ns>--<slug>/<file>.md`
7. Copy referenced `.md` files into the split folder.
8. Keep external links unchanged.
9. Write `<ns>--split/llms.txt` as the split index.

### Strategy: `--by path`

1. Parse every link URL in the manifest.
2. For own-entry links, group by first path segment after `<ns>/` where possible.
3. For external URLs, group by first meaningful URL path segment.
4. Use the same write/copy/index behavior as `--by sections`.
5. This is intended for flat manifests like one huge `## Pages` section.

### Strategy: `--by manual`

Without `--plan`, emit JSON to stdout:

```json
{
  "namespace": "langchain",
  "strategy": "manual",
  "groups": [
    {
      "slug": "core",
      "title": "Core",
      "linkUrls": ["/api/entries/get?name=langchain/core.md"]
    }
  ]
}
```

With `--plan plan.json`, validate and apply that plan.

### Split Manifest Template

```markdown
# <Original Title> - <Group Title>

> <original summary>

> Note: derived from `<namespace>` (full). Split by <strategy>. Generated <YYYY-MM-DD>.

## <Group Title>

- [<Entry Title>](/api/entries/get?name=<namespace>--<slug>/<file>.md): <description>
```

Use ASCII punctuation in generated files.

### Split Index Template

```markdown
# <Original Title> (split)

> Split slices of `<namespace>`, grouped by <strategy>. Each link below is a self-contained namespace.

> Note: derived from `<namespace>` (full). Generated <YYYY-MM-DD>.

## Slices

- [<Original Title> - <Group Title>](/<namespace>--<slug>/llms.txt): <N> links
```

### Edge Cases

- Namespace does not exist: exit 1 with a clear message.
- `llms.txt` missing or invalid: exit 1.
- No groups produced: exit 1.
- Section with one link: still produce a split.
- Duplicate section/path slugs: append numeric suffix.
- Reserved namespace words (`api`, `static`, `assets`, `llms.txt`): append numeric suffix.
- Entry referenced by two groups: copy into both split folders.
- Entry not referenced by manifest: leave in original only and report as orphan.
- Split-of-a-split: reject namespaces containing `--` unless explicitly allowed later.
- Re-running split: overwrite generated sibling folders for the same output names; never touch original.

### Implementation Touchpoints

| File | Work |
|---|---|
| `server/bin/docs-import.ts` | Add `split` subcommand and helpers. |
| `server/parser.ts` | Reuse existing parser if sufficient; avoid parser changes unless required. |
| `server/own.ts` | No required change; optional helper later for split metadata. |
| `docs/agent-guide.md` | Add one paragraph documenting optional split after import. |

### Verification

- Run `pnpm typecheck`.
- Run dry-run against a small existing namespace such as `demos`.
- Run real split against a throwaway namespace.
- Confirm generated `/<ns>--split/llms.txt` and `/<ns>--<slug>/llms.txt` are valid by inspecting files.
- Start the app if needed and fetch generated namespace URLs manually.

### Done Criteria

- `pnpm docs-import split <namespace> --by sections --dry-run` works.
- `pnpm docs-import split <namespace> --by sections` writes sibling namespaces and a split index.
- Own-entry links are rewritten and copied correctly.
- Original namespace remains byte-for-byte unchanged.
- Failures return clear non-zero CLI exits.

---

## Phase 2 — Namespace Health Checks

Status: **implemented 2026-06-04** in `server/health.ts` and `server/bin/docs-import.ts`.

### Goal

Add a CLI health check that tells an operator whether a namespace is agent-ready.

Example:

```bash
pnpm docs-import check demos
pnpm docs-import check --all
```

### CLI Shape

```bash
pnpm docs-import check <namespace>
pnpm docs-import check --all
pnpm docs-import check <namespace> --json
```

### Checks

- `llms.txt` exists.
- Manifest parses with H1, summary blockquote, sections, and link list.
- Every own-entry link resolves to an existing file.
- No own-entry link escapes `data/own/`.
- Entry files are not tiny stubs unless explicitly allowed.
- Entry files are not oversized, default warning above ~40k chars.
- Manifest link count warning above a configurable threshold, default 100 links.
- Section link count warning above a configurable threshold, default 50 links.
- Duplicate link URLs.
- Orphan `.md` files in namespace not linked by manifest.
- Raw HTML leak patterns such as `<div`, `<script`, `<style`.
- Split recommendation:
  - many links across multiple H2 sections -> recommend `--by sections`
  - one huge flat section with varied paths -> recommend `--by path`

### Output

Human output should be concise:

```text
demos: healthy
  links: 2
  entries: 2
  warnings: 0
```

JSON output should be stable enough for the UI to consume later:

```json
{
  "namespace": "demos",
  "status": "healthy",
  "errors": [],
  "warnings": [],
  "stats": {
    "links": 2,
    "entries": 2,
    "orphans": 0
  },
  "recommendation": null
}
```

### Implementation Touchpoints

| File | Work |
|---|---|
| `server/health.ts` | Shared health report logic for CLI now and dashboard later. |
| `server/bin/docs-import.ts` | Add `check` subcommand. |
| `server/parser.ts` | Reuse manifest parser. |
| `server/own.ts` | Reuse namespace/list/read helpers where practical. |

### Verification

- Run `pnpm typecheck`.
- Check a healthy namespace.
- Create or use a throwaway broken namespace and confirm clear errors.
- Confirm `--json` output is valid JSON.

### Done Criteria

- CLI reports healthy/warn/error status.
- CLI exits non-zero for hard errors.
- Oversized namespaces produce a split recommendation.

---

## Phase 3 — Dashboard Health Signals

Status: **implemented 2026-06-04** in `server/routes/health.ts`, `ui/api.ts`, `ui/App.tsx`, `ui/components/Dashboard.tsx`, and `ui/components/Sidebar.tsx`.

### Goal

Make the UI answer the operator's immediate control-plane questions:

- What should agents read first?
- Which namespaces are healthy?
- Which namespaces are too large?
- Which docs are stale or broken?
- Which external sources are active/trusted?

### API Shape

Add a read endpoint:

```http
GET /api/health/namespaces
GET /api/health/namespaces/:name
```

Return the same shape as `docs-import check --json`.

### UI Work

- Add health status badges to namespace cards/list items.
- Show warnings for oversized namespaces.
- Show a recommended split command when applicable.
- Keep this read-only in v1. Do not add a split button yet unless Phase 1 and 2 are stable.

### Implementation Touchpoints

| File | Work |
|---|---|
| `server/routes/health.ts` | New route group. |
| `server/index.ts` | Register health routes. |
| `server/health.ts` | Shared health logic if extracted from CLI. |
| `ui/api.ts` | Add typed fetch helpers. |
| `ui/components/Dashboard.tsx` / `Sidebar.tsx` | Surface status and warnings. |

### Verification

- Run `pnpm typecheck`.
- Start `pnpm dev`.
- Open UI and verify namespace health renders.
- Manually fetch `/api/health/namespaces`.

### Done Criteria

- Dashboard shows health status without mutating files.
- API and CLI share the same health semantics.

### Verification Notes

- `pnpm typecheck` passes.
- `pnpm build` passes when run outside the sandbox so Vite/esbuild can spawn.
- `GET /api/health/namespaces`, `/api/health/namespaces/demos`, and `/api/health/namespaces/test-2` return the shared report shape.
- Browser visual verification was attempted, but no in-app browser backend was available in this session.

---

## Phase 4 — Read-Only Agent View

Status: **implemented 2026-06-06** in `server/routes/agent.ts`, `ui/components/AgentView.tsx`, `ui/App.tsx`, `ui/api.ts`, and `ui/components/Sidebar.tsx`.

### Goal

Expose a simple read-only view that helps humans copy the right URLs into coding agents.

### Route Shape

```http
GET /agent
GET /api/agent/index
```

### Contents

- Master manifest URL.
- Namespace manifest URLs.
- Split index URLs.
- Active merged external docs URL.
- Suggested usage snippets:
  - "Start here"
  - "Use this namespace"
  - "Use this split index for smaller context models"

### Implementation Touchpoints

| File | Work |
|---|---|
| `server/routes/agent.ts` | Optional API route. |
| `ui/components/AgentView.tsx` | New read-only page/component. |
| `ui/App.tsx` | Navigation entry. |
| `ui/api.ts` | Fetch agent index. |

### Verification

- `pnpm typecheck` passes.
- `pnpm build` passes when run outside the sandbox so Vite/esbuild can spawn.
- `GET /api/agent/index` returns master, merged, namespace, health, active-source, and snippet data.
- `GET /agent` serves the built UI.

### Done Criteria

- A human can quickly see which URL an agent should read first.
- Split namespaces are discoverable when present.

---

## Phase 5 — Trust Metadata For External Sources

Status: **implemented 2026-06-06** in `server/db.ts`, `server/routes/sources.ts`, `server/routes/agent.ts`, `ui/api.ts`, `ui/components/SourceView.tsx`, `ui/components/Dashboard.tsx`, and `ui/styles.css`.

### Goal

Make source trust explicit. The project should not just cache docs; it should record why a source is trusted and how it should be used.

### Data Fields

Extend source metadata where appropriate:

- `owner` or `added_by`
- `trust_note`
- `intended_use`
- `warning`
- `last_reviewed_at`
- `promotion_reason`

Existing fields like `tags`, `notes`, `state`, and `ttl_hours` should remain.

### UI Work

- Show trust note and warning in source detail.
- Require or strongly encourage a promotion reason when moving trial -> active.
- Display "last reviewed" on active sources.

### Verification

- `pnpm typecheck` passes.
- `pnpm build` passes when run outside the sandbox so Vite/esbuild can spawn.
- Existing sources load with nullable trust fields.
- Reversible source PATCH verified `owner`, `trust_note`, `intended_use`, `warning`, `last_reviewed_at`, and `promotion_reason`.
- `/api/agent/index` includes trust metadata for active external sources.

---

## Phase 6 — Snapshot And Refresh History

Status: **implemented 2026-06-07** in `server/db.ts`, `server/fetcher/source.ts`, `server/routes/sources.ts`, `ui/api.ts`, `ui/components/SourceView.tsx`, and `ui/styles.css`.

### Goal

Let operators inspect upstream drift and recover from bad refreshes.

### Capabilities

- Record refresh attempts.
- Record content changed/not changed.
- Keep previous normalized markdown snapshots for changed external links.
- Show a small diff summary or changed count.
- Allow rollback later, if needed.

### First Slice

Start with read-only history:

```http
GET /api/sources/:id/history
GET /api/links/:id/history
```

Rollback can be a later slice.

### Verification

- `pnpm typecheck` passes.
- `pnpm build` passes when run outside the sandbox so Vite/esbuild can spawn.
- `GET /api/sources/:id/history` returns source refresh records.
- `GET /api/links/:id/history` returns link refresh records.

---

## Phase 7 — Basic Write Protection

Status: **done 2026-06-07.** Implemented as a shared bearer-token check in `server/write-protect.ts`, applied to mutating handlers in `server/routes/{entries,llms,sources}.ts`. Reads stay open by default; write protection only activates when `WRITE_TOKEN` is set.

### Resolved decisions

- [x] **Single shared `WRITE_TOKEN`, not per-user auth.** One static token in env, checked as `Authorization: Bearer <token>`. No accounts/sessions.
- [x] **Protect mutating handlers only.** Read endpoints remain open.
- [x] **Read-only POSTs stay open only where they truly do not mutate state.** `POST /api/sources/probe` remains open; `POST /api/llms/own/regenerate` is gated because it rewrites state.
- [x] **UI writes are not token-aware yet.** The API gate is in place; if `WRITE_TOKEN` is set, callers must send the bearer themselves.

### Implementation note

The code uses route-local guards instead of a single global `onRequest` hook. That keeps the blast radius narrow for this phase and still protects every mutating endpoint we ship today:

- `PUT /api/entries`
- `DELETE /api/entries`
- `PUT /api/llms/own`
- `POST /api/llms/own/regenerate`
- `PUT /api/namespaces/:name/note`
- `POST /api/namespaces`
- `DELETE /api/namespaces/:name`
- `PUT /api/namespaces/:name/llms`
- `POST /api/sources`
- `PATCH /api/sources/:id`
- `DELETE /api/sources/:id`
- `POST /api/sources/:id/refresh`
- `POST /api/links/:id/refresh`

### Verification

1. `pnpm typecheck`
2. `pnpm build`
3. `PUT /api/entries` without `Authorization` returns `401` and `WWW-Authenticate: Bearer`
4. `PUT /api/entries` with `Authorization: Bearer <token>` returns `200`

---

## Phase 8 — Search

### Goal

Help humans and agents find the right namespace or entry before fetching too much.

### First Version

- Search `data/own/**/*.md`.
- Search namespace manifests.
- Search cached external markdown metadata.
- Return title, namespace/source, snippet, and URL.

### Route Shape

```http
GET /api/search?q=<query>
```

### Later

Consider SQLite FTS if simple search is too slow. Do not add heavy search infrastructure until the basic behavior proves useful.

---

## Track R — Ingestion Router & CSR/SPA Handling

> A parallel track (not one of the numbered phases) that runs **ahead of Phase 8**. It hardens the *input side* of the control plane: turning any input — URL, swagger, pptx, PDF, pasted text, or a horrible client-side-rendered SPA — into a namespace that satisfies `namespace/SPEC.md`. Read `ingest/SPEC.md` and `namespace/SPEC.md` before touching this.

### Why

Inputs grew beyond clean URLs. Two failure modes had to be closed: (1) arbitrary local material (pptx/paste/PDF) had no ingestion path, and (2) **CSR/SPA pages** returned an empty shell from static fetch, failing *silently*. Both `docs-import`'s `fetch-clean` and a plain web fetch are static-HTML only — neither runs JS.

### Locked decisions

- [x] **Two ingestion lanes, one output contract.** `docs-import` (URL → CLI fetch/parse) and `llms-compose` (local material → agent reads it). Both must satisfy `namespace/SPEC.md`. Front door = `ingest/SPEC.md`.
- [x] **CSR/SPA = a 3-rung ladder, graceful degradation** (chosen over CLI-only render or paste-only): `mdTwin` shortcut → headless render → operator reader-mode paste. Prefer the cheapest lossless rung.
- [x] **`llms-compose` produces no new output shape** — same `data/own/<ns>/` namespace; only the reader differs. It centers on a metadata interview that fills the gaps raw material leaves (base URL, auth, summary, provenance) — **asks, never invents**.

### Increment 1 — Router + CSR detection + md-twin shortcut — **DONE 2026-06-20** (committed 2026-06-21)

Shipped: `probe` (in `server/bin/docs-import.ts`) returns `rendering: 'ssr' | 'csr'` and `mdTwin: string | null`. `detectCsr()` flags client-side rendering from an empty mount container or low rendered-text + multiple scripts (framework markers only corroborate, so SSG-with-content is not a false positive). `findMdTwin()` discovers `/page.md` shortcuts. Authored `namespace/SPEC.md` (output contract + quality gate), `ingest/SPEC.md` (front door + ladder), and the `llms-compose` skill (DRAFT); wired the `docs-import` skill to check `rendering` first.

Verified: `pnpm typecheck` clean; live `fastify.dev` stays `ssr`; a local SPA-shell server reports `csr`, finds the twin when present and emits the paste-fallback warning when absent.

### Increment 2 — Headless render rung (opt-in dep) — **DONE 2026-06-20** (committed 2026-06-21)

The middle rung: only reached when `rendering=csr` AND no `mdTwin`.

Shipped: `pnpm docs-import fetch-clean <url> --render` lazy-imports Playwright Chromium, loads the page with `waitUntil: 'networkidle'`, optionally waits for `--wait-for <selector>`, then passes the rendered DOM through the shared `htmlToMarkdown(html, url)` Readability/Turndown pipeline. Playwright is declared as a dev dependency and loaded only for `--render`; the README documents `pnpm exec playwright install chromium`. Missing package/browser paths exit non-zero with install guidance and point operators to the paste rung.

Verification: `pnpm typecheck`; `fetch-clean <real-CSR-doc-page> --render` yields non-junk markdown that passes `passesSanity`; the missing-dep path prints actionable guidance and exits non-zero.

### Increment 3 — Prove + drop DRAFT + commit — **DONE 2026-06-21** (committed `fc009d9`)

Dry-run completed with the local Track R spec files as real local material. `llms-compose` produced `data/own/ingestion-router/`, and `pnpm docs-import check ingestion-router` reports healthy with 3 links, 3 entries, and 0 warnings. Removed the `DRAFT.` marker from `.claude/skills/llms-compose/SKILL.md`. Slice committed and pushed.

### Touchpoints

| File | Work |
|---|---|
| `server/bin/docs-import.ts` | `probe` CSR/twin fields (done); `fetch-clean --render` (done). |
| `server/fetcher/fetch.ts` | Expose `htmlToMarkdown(html, url)` for the render path (done). |
| `ingest/SPEC.md` | Front door + ladder (done). Canonical for routing. |
| `namespace/SPEC.md` | Output contract + quality gate (done). Canonical for "what good looks like". |
| `.claude/skills/{docs-import,llms-compose}/SKILL.md` | Procedures; both link the router (done; drop `llms-compose` DRAFT in Inc 3). |

---

## Track M — Intranet Mirror & Internal-Manual Strategy

> The deployment track: turn the built control plane into the thing it was for. Two use cases, one purpose — **pay the pptx/excel/image parsing cost once, serve clean markdown to every agent on the intranet.**
>
> - **UC1 — external mirror:** register external `llms.txt` sources (e.g. `code.claude.com/llms.txt`), cache manifest + sub-linked docs, serve them on the intranet.
> - **UC2 — internal manuals:** compose internal work-process / API / system manuals (pptx, excel, images) into `llms.txt` namespaces via `llms-compose`, review, serve.

### Locked decisions

- [x] **Cache-resolved serving for intranet agents.** Served manifests emitted upstream external URLs, so agents without internet could not use the cache. `?resolve=local` on `/agent/llms.txt`, `/agent/sources/:id/llms.txt`, and `/llms.txt?merge=true` rewrites cached links to `/api/links/:id/content`; uncached links keep their upstream URL.
- [x] **`llms-compose` gains a mandatory architecture checkpoint.** After analyzing the material, the agent presents the plan (inventory, profile, entry files, sections, gaps) and the operator discusses/confirms **before any file is written**. Confirmed 2026-07-02 as the preferred process.
- [x] **Excel is a first-class compose input** (per-sheet dump → markdown tables); it was missing from the skill's input table despite being the highest-fidelity manual format.
- [x] **Prioritize manuals by re-parse frequency.** Conversion value = (parse cost per query) × (queries per week); convert the most-consulted material first.
- [x] **Human review stays the accuracy gate.** `check` validates structure, not truth; composed namespaces stay `draft` until reviewed. Re-compose on manual change is a manual, reviewed event — do not automate.

### Increment M1 — Cache-resolved serving (`?resolve=local`) — **DONE 2026-07-02**

Shipped in `server/routes/llms.ts` (`sourceDoc`/`mergedAgentDoc` take a `resolveLocal` flag; `wantsLocalResolve` reads the query param) and `server/routes/agent.ts` (`/api/agent/index` advertises `llmsLocalUrl` per source plus an "Intranet / offline" snippet; `/agent/sources` returns `llmsLocalUrl`).

### Increment M2 — Compose-skill upgrades — **DONE 2026-07-02**

`.claude/skills/llms-compose/SKILL.md`: added the xlsx input row and the Step 2 architecture checkpoint (steps renumbered; new hard rule "No files before the plan is confirmed").

### Increment M3 — UC1 pilot: real external mirror

Register a real external source (e.g. `https://code.claude.com/llms.txt`), let the scheduler cache manifest + links. **Acceptance test:** from a machine (or session) without internet access, an agent uses `llms-txt-reader` against `/agent/llms.txt?resolve=local` and correctly answers questions grounded in the mirrored docs. Prefer `llms-full.txt` variants when a source publishes one (link caching is one level deep by design).

### Increment M4 — UC2 pilot: first real internal manual

Pick the internal manual set agents currently re-parse most often (ideally a pptx + excel pair). Prepare interview answers up front (base URL, auth, version, audience, known gaps), run `llms-compose` through the new checkpoint flow, pass `pnpm docs-import check`. **Acceptance test:** a fresh agent session answers 3–5 real task questions from the served namespace alone. Failures point at the entry/description to fix.

### Increment M5 — Scale with governance

Before wide intranet exposure: set `WRITE_TOKEN`; establish namespace naming/tag conventions per team or system; assign an owner + review cadence per namespace (`.meta.json` trust fields exist since Phase 5); keep everything `draft` until reviewed. Curation quality over volume — ten reviewed namespaces beat fifty raw dumps.

### When Phase 8 (Search) triggers

Manifest-based selection works to a few dozen namespaces. When agents start picking the wrong namespace from the index alone, start Phase 8.

---

## Phase Order And Agent Handoff

Agents should work in this order unless the user explicitly redirects:

1. Phase 1 docs-split CLI.
2. Phase 2 health checks.
3. Phase 3 dashboard health signals.
4. Phase 4 read-only agent view. **Done.**
5. Phase 5 trust metadata. **Done.**
6. Phase 6 refresh history. **Done.**
7. Phase 7 write protection. **Done.**
8. Phase 8 search.

For each phase:

1. Read `MISSION.html`, `CLAUDE.md`, `CONTEXT.md`, and this file.
2. Inspect the relevant source files before editing.
3. Keep changes narrowly scoped to the phase.
4. Update docs when behavior changes.
5. Run `pnpm typecheck`.
6. Manually verify the new CLI/API/UI path.
7. Update `CONTEXT.md` with what changed and the next step.

## Immediate Next Step

Track R is committed. **Track M is the active thread** and runs ahead of Phase 8:

1. **Track M3 — UC1 pilot** (active) — register a real external `llms.txt`, verify the `?resolve=local` mirror with the offline acceptance test.
2. **Track M4 — UC2 pilot** (next) — compose the first real internal manual (pptx/excel) through the new checkpoint flow; fresh-agent acceptance test.
3. **Phase 8 — Search** (queued) — starts when namespace selection from the manifest alone stops scaling.

A fresh agent picking up here should read Track M, run M3, then M4. Read the Phase 8 section and inspect the existing routes before starting Search.
