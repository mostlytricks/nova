---
name: docs-import
description: Import a documentation site into this local-llmstxt-server project. Use when the user asks to import, scrape, convert, or add docs (API references, framework docs, OpenAPI/Swagger specs, dev guides) from a URL into a namespace folder under `data/own/`. Produces clean markdown files plus an `llms.txt` manifest that the server will serve.
---

# docs-import

You are the "producing agent" that turns human documentation websites into agent-ready markdown for this project. Read this whole skill before starting.

## What you produce

Files in `data/own/<namespace>/`:

- `llms.txt` — manifest with title, summary, and link list (follows the [llmstxt.org spec](https://llmstxt.org/))
- `<topic>.md` files — clean markdown content the manifest links to
- `.meta.json` — Local Docs metadata when you create or materially revise the namespace

The user's running `local-llmstxt-server` will serve these:
- `GET /<namespace>/llms.txt` — the manifest
- `GET /api/entries/get?name=<namespace>/<file>.md` — each entry

## Local Docs profile

Before writing, choose the Local Docs profile from `.gravity/namespace/SPEC.md`:

- `api` — OpenAPI/Swagger, REST, GraphQL, RPC, SDK-backed services, internal APIs.
- `website` — product websites, web apps, SaaS consoles, internal tools, rendered doc sites.
- `library` — package/library docs.
- `notes` — operator notes or mixed local material that does not yet deserve a tighter profile.

Write the profile to `data/own/<namespace>/.meta.json` along with the fields you can support from source material:

```json
{
  "state": "draft",
  "doc_type": "api",
  "origin_url": "https://example.com/openapi.json",
  "base_url": "https://api.example.com/v1",
  "auth_summary": "Bearer token; see auth.md",
  "version": "v1",
  "known_gaps": "No retry policy found in source",
  "tags": [],
  "notes": "Draft import. Review before promotion."
}
```

Only fill fields the source actually supports. Missing values stay `null` or are called out in `known_gaps`; do not invent them.

## Your tools

**Do not fetch, parse HTML, or read OpenAPI specs yourself.** Use the project's CLI — it handles all of that. You orchestrate and make editorial decisions.

```bash
pnpm docs-import probe <url>
# → JSON: { kind, rootUrl, title, summary, suggestedNamespace, seedUrls, openapiSpecUrl, rendering, mdTwin, warnings }
# `kind` is one of: openapi | llmstxt | sitemap | nav | single
# `rendering` is 'ssr' | 'csr'  — 'csr' means content is NOT in static HTML (see SPA ladder below)
# `mdTwin` is a pre-rendered markdown URL for the root page, or null

pnpm docs-import fetch-clean <url>
# → stdout: clean markdown (Readability + Turndown, sanity-checked)
# → exit 1 if the page is junk (too short, leaked HTML, no real content) — skip and continue

pnpm docs-import fetch-clean <url> --render [--wait-for <selector>]
# → same output, but first renders the page in headless Chromium for CSR/SPAs
# → requires Playwright + Chromium (`pnpm install`; `pnpm exec playwright install chromium`)

pnpm docs-import openapi <spec-url>
# → JSON: { info, servers, securitySchemes, tags: [{ name, description, endpoints: [...] }] }
```

You also have normal file tools (Read, Write, Edit, Bash). Use Write to create the entry files and `llms.txt`.

## Step 0 — Ask the operator first

Don't assume. Confirm these before starting:

1. **Output mode**:
   - **A. Full namespace** (default) — `data/own/<name>/llms.txt` + N entry files
   - **B. Entries only** — just the `.md` files, operator writes the manifest
   - **C. Condensed single file** — one `data/own/<name>.md` (loose entry, no folder)
2. **Namespace name** — confirm or override the `suggestedNamespace` from `probe`
3. **Local Docs profile** — propose `api`, `website`, `library`, or `notes`
4. **Scope** — whole site or one section (e.g. only `/docs/api/...`)?
5. **Overwrite** — if `data/own/<name>/` already exists, replace or merge?

If the user says "just go," default to mode A with the suggested namespace and inferred profile, then proceed. Keep the namespace `draft` until reviewed.

## Step 1 — Probe

```bash
pnpm docs-import probe <url>
```

Read the JSON. **Check `rendering` first**, then branch on `kind`:

- **`rendering: "csr"`** → the page is a client-side-rendered SPA; static fetch yields an empty shell. **Do not crawl it directly.** Follow the **SPA ladder** in `.gravity/ingest/SPEC.md`: prefer `probe.mdTwin` (fetch it with `fetch-clean` and treat as normal), else `fetch-clean <url> --render` (Increment 2), else hand off to the **`llms-compose`** skill via operator reader-mode paste. The `warnings` field spells out which rung applies.
- **`rendering: "ssr"`** → content is in the HTML; branch on `kind` as normal:

| `kind` | What to do |
|---|---|
| `openapi` | Jump to **OpenAPI workflow** below. Skip HTML entirely. |
| `llmstxt` | The site already has its own curated `llms.txt`. Use `seedUrls` as-is — they're hand-picked. Continue to **Crawl workflow**. |
| `sitemap` | Use `seedUrls` (sitemap filtered to same path prefix). **Crawl workflow**. |
| `nav` | Use `seedUrls` (extracted from nav/sidebar). Expect noisier results — be willing to skip pages. **Crawl workflow**. |
| `single` | One page only. **Single-page workflow**. |

## OpenAPI workflow

```bash
pnpm docs-import openapi <openapiSpecUrl>
```

Set Local Docs profile to `api`. The JSON is already dereferenced (no `$ref`) and grouped by `tags[0]`. Prefer this API Local Docs shape:

- `overview.md` — API purpose, version, base URL/server list, resource model, audience.
- `auth.md` — auth scheme documented once from `securitySchemes`.
- one resource/tag file per meaningful tag, such as `orders.md` or `deployments.md`.
- `schemas.md` when shared schemas are important and not clear inline.
- `errors.md` when the spec documents common error responses, rate limits, idempotency, or retry behavior.

Do not emit one tiny file per endpoint. Group endpoints by tag/resource.

For each tag/resource entry, write `data/own/<namespace>/<tag-slug>.md` using this template:

````markdown
# <Tag name>

<tag.description, or one sentence you write summarizing what this group does>

## `<METHOD> <path>` — <endpoint.summary>

<endpoint.description, 1–3 sentences>

**Parameters**

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes | The thing's id |

**Request body** (`application/json`)

```json
{ ...endpoint.requestBody.example, or omit if no example... }
```

**Responses**

- `200` — <response.description>. Example:
  ```json
  { ...response.example, or omit... }
  ```
- `404` — Not found.
````

Repeat the `##` section for every endpoint in the tag.

Rules:
- **Skip Example/Request body if the spec has no example.** Do NOT invent values.
- Order endpoints as the spec returned them.
- If a tag has only 1–2 endpoints AND another tag is also tiny, merge them into one entry with a heading per tag — don't produce stub files.
- Document auth ONCE in `auth.md`, pulling from `securitySchemes`. Link it from `Start Here`.

Then write the manifest (see "Step 3" below) with `Start Here` and `Reference` sections.

## Crawl workflow (`llmstxt` / `sitemap` / `nav`)

### Fetch each page

For each URL in `seedUrls` (up to ~200, the probe already caps):

```bash
pnpm docs-import fetch-clean <url>
```

- Capture stdout as the page's markdown.
- If exit code 1, log the URL as skipped and **move on** — don't try to recover.
- Throttle: 300ms between calls to the same host.

Build a list of `{ url, title, markdown }` (extract title from the first `#` heading or use the URL's last path segment).

### Group into entries

Choose profile:

- API reference pages → `api`
- product/app docs → `website`
- package docs → `library`
- mixed notes → `notes`

Don't write one file per URL — that's noisy. Group:

1. **By URL path structure and profile.** Website/app docs usually become `overview.md`, `navigation.md`, `workflows.md`, `concepts.md`, `caveats.md`. API docs become `overview.md`, `auth.md`, resource/tag files, `errors.md`.
2. If grouping isn't obvious from URLs, ask the operator (show them the URL list grouped by first path segment after `rootUrl.pathname`).
3. **Hard cap per entry: ~40k chars.** Split if bigger (e.g. `guides-1.md`, `guides-2.md`).
4. **Soft min: 300 chars.** Merge tiny groups into a sibling.

Within an entry, concatenate pages in the order they appeared in `seedUrls`, each prefixed with `## <page title>`.

### Write entries

For mode A or B: `data/own/<namespace>/<group-slug>.md` per group.
For mode C: one file `data/own/<namespace>.md` with everything concatenated.

## Single-page workflow

```bash
pnpm docs-import fetch-clean <url>
```

Write stdout to `data/own/<namespace>.md` (loose entry, no folder). If the operator wanted a namespace, write to `data/own/<namespace>/<slug>.md` and a minimal `llms.txt` linking it.

## Step 3 — Write the manifest (modes A + OpenAPI)

Path: `data/own/<namespace>/llms.txt`

Template:

```markdown
# <Product name>

> <1–2 sentence elevator pitch. From probe's title/summary or your crisp restatement.>

> Source: <rootUrl>. Imported <YYYY-MM-DD>.

## <Section name>

- [<Entry title>](/api/entries/get?name=<namespace>/<file>.md): <one-line description>
```

Rules:
- **Title** = product name (e.g. `# Fastify`), not the namespace slug.
- **Summary blockquote** + an "imported on" line so the user can spot staleness.
- **Section names** mirror your entry grouping (e.g. `Guides`, `API Reference`, `Endpoints by Tag`). Most namespaces have 1–4 sections.
- For API Local Docs, prefer `Start Here` + `Reference`.
- For Website/Product Local Docs, prefer `Start Here` + `Workflows` + `Reference`/`Caveats`.
- **Link path is exactly** `/api/entries/get?name=<namespace>/<file>.md`. This is the server's URL for serving own entries.
- **Description** = one line, what's in the entry. E.g. `"Routing, middleware, hooks lifecycle"`. Not "this entry contains…".
- Get today's date from the system; do NOT hardcode.

## Step 4 — Metadata + quality checks

Write or update `data/own/<namespace>/.meta.json`:

- `state`: `draft` for new imports until the operator reviews/promotes it.
- `doc_type`: selected profile.
- `origin_url`: root URL, OpenAPI URL, or source URL.
- `base_url`: API server URL or website base URL when known.
- `auth_summary`: short auth description, or `null` if unknown.
- `version`: API/product/library version when known.
- `known_gaps`: missing facts agents must not invent.
- Keep existing `owner`, `trust_note`, `intended_use`, `warning`, `last_reviewed_at`, and `promotion_reason` if present.

Before declaring done:

- [ ] `data/own/<namespace>/llms.txt` exists and is valid (H1, blockquote, sections, link list).
- [ ] Every link in the manifest resolves to a file you wrote.
- [ ] No entry under 300 chars (likely a stub — merge or drop).
- [ ] No entry over ~40k chars (split it).
- [ ] No raw HTML tags in any `.md` (`<div`, `<script`, etc.).
- [ ] No marketing fragments leaked ("Sign up for our newsletter", "© 2024", "Edit this page on GitHub").
- [ ] All code blocks have language hints where appropriate (` ```ts `, ` ```python `).
- [ ] `.meta.json` has the correct `doc_type` and captures source/provenance gaps.

Fix anything that fails or report it explicitly.

## Step 5 — Report back

Concise summary to the operator:

```
Imported <namespace> from <rootUrl>
  Mode: <A|B|C>
  Source kind: <openapi|llmstxt|sitemap|nav|single>
  Pages fetched: <N> (skipped: <M>)
  Entries written: <K>
  Manifest: data/own/<namespace>/llms.txt
  Notes: <anything weird, e.g. "JS-rendered, content sparse on /api/* pages">
  Metadata: <doc_type, origin_url, base_url/version/auth if known, known gaps>
```

## Hard rules

- **Don't invent content.** If a page is sparse, leave it sparse. No filler prose, no plausible-sounding example values.
- **Don't normalize style.** Keep the source's voice. You're an importer, not a copywriter.
- **Don't add AI-summary preambles.** Other agents read these files; they don't need "This document explains…" intros.
- **Don't follow outbound links.** Stay on the seed list `probe` gave you.
- **Don't translate.** Keep the original language.
- **Don't re-implement the CLI's job.** No raw `fetch`, no `JSDOM`, no manual OpenAPI parsing. If the CLI is missing a capability, tell the user so they can extend it — don't work around it.

## When to ask vs proceed

**Ask** when:
- Output mode is ambiguous
- Namespace name collision (folder exists)
- Grouping is unclear (e.g. flat doc site with 80 URLs and no obvious sections)
- Probe found nothing (kind=`single`, only 1 URL, suspiciously short)

**Just proceed** when:
- Probe returned a clean plan with clear `kind` and `suggestedNamespace`
- OpenAPI spec is well-tagged
- User explicitly said "just go"

## Reference

- `.gravity/ingest/SPEC.md` — the front door: input → lane, and the SPA ladder for `rendering: "csr"`.
- `.gravity/namespace/SPEC.md` — the output contract + quality gate every namespace must satisfy.
- `docs/agent-guide.md` — full background; re-read it if the source site behaves unexpectedly.
