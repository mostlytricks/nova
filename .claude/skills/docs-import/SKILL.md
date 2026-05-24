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

The user's running `local-llmstxt-server` will serve these:
- `GET /<namespace>/llms.txt` — the manifest
- `GET /api/entries/get?name=<namespace>/<file>.md` — each entry

## Your tools

**Do not fetch, parse HTML, or read OpenAPI specs yourself.** Use the project's CLI — it handles all of that. You orchestrate and make editorial decisions.

```bash
pnpm docs-import probe <url>
# → JSON: { kind, rootUrl, title, summary, suggestedNamespace, seedUrls, openapiSpecUrl, warnings }
# `kind` is one of: openapi | llmstxt | sitemap | nav | single

pnpm docs-import fetch-clean <url>
# → stdout: clean markdown (Readability + Turndown, sanity-checked)
# → exit 1 if the page is junk (too short, leaked HTML, no real content) — skip and continue

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
3. **Scope** — whole site or one section (e.g. only `/docs/api/...`)?
4. **Overwrite** — if `data/own/<name>/` already exists, replace or merge?

If the user says "just go," default to mode A with the suggested namespace and skip the rest.

## Step 1 — Probe

```bash
pnpm docs-import probe <url>
```

Read the JSON. Branch on `kind`:

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

The JSON is already dereferenced (no `$ref`) and grouped by `tags[0]`. **One entry per tag.**

For each tag, write `data/own/<namespace>/<tag-slug>.md` using this template:

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
- Document auth ONCE at the top of the manifest (or in a separate `auth.md`), pulling from `securitySchemes`.

Then write the manifest (see "Step 3" below) with one section per tag entry.

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

Don't write one file per URL — that's noisy. Group:

1. **By URL path structure.** Pages under `/docs/guides/...` → one entry. `/docs/api/...` → another. `/docs/reference/...` → another.
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
- **Link path is exactly** `/api/entries/get?name=<namespace>/<file>.md`. This is the server's URL for serving own entries.
- **Description** = one line, what's in the entry. E.g. `"Routing, middleware, hooks lifecycle"`. Not "this entry contains…".
- Get today's date from the system; do NOT hardcode.

## Step 4 — Quality checks

Before declaring done:

- [ ] `data/own/<namespace>/llms.txt` exists and is valid (H1, blockquote, sections, link list).
- [ ] Every link in the manifest resolves to a file you wrote.
- [ ] No entry under 300 chars (likely a stub — merge or drop).
- [ ] No entry over ~40k chars (split it).
- [ ] No raw HTML tags in any `.md` (`<div`, `<script`, etc.).
- [ ] No marketing fragments leaked ("Sign up for our newsletter", "© 2024", "Edit this page on GitHub").
- [ ] All code blocks have language hints where appropriate (` ```ts `, ` ```python `).

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

Full background: `docs/agent-guide.md` in this project. Re-read it if the source site behaves unexpectedly.
