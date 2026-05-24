# Agent guide — converting human docs into agent-ready namespaces

This is a working spec for an agent (your "tiny agent") that takes a documentation URL and produces files for `data/own/<namespace>/`. Output is markdown intended for *other* agents to read via `local-llmstxt-server`.

**You (the producing agent) operate standalone**: fetch directly, write files directly. Don't depend on the server being up.

## Your tools

You have one CLI: **`docs-import`** (run via `pnpm docs-import <subcommand> <args>`). Use it instead of fetching/parsing yourself — it handles HTTP, Readability extraction, HTML→markdown, and OpenAPI parsing for you.

```
pnpm docs-import probe <url>
  → JSON plan: { kind, rootUrl, title, summary, suggestedNamespace, seedUrls, openapiSpecUrl, warnings }

pnpm docs-import fetch-clean <url>
  → stdout: clean markdown (Readability-extracted, sanity-checked)
  → exit 1 if the page fails sanity (too short, HTML leaked, no real content)

pnpm docs-import openapi <spec-url>
  → JSON: { info, servers, securitySchemes, tags: [{ name, description, endpoints: [...] }] }
```

Your job is to **orchestrate these three commands and decide editorial things** (entry grouping, titles, summaries) — not to re-implement fetching or HTML parsing. If a step fails, log it and continue with what you have.

---

## 1. Choose an output mode

Ask the operator which mode before starting. Each affects how aggressively you crawl and how you split content.

| Mode | When to use | Output |
|---|---|---|
| **A. Full namespace** | Doc site is sizeable AND well-organized into topics (framework docs, big API ref). | `data/own/<name>/llms.txt` + N entry `.md` files, one per logical topic. |
| **B. Entries only** | Operator wants editorial control of the manifest, or topics aren't crisp. | `data/own/<name>/*.md` files. Operator writes the llms.txt. |
| **C. Condensed single file** | Small/medium doc set; one well-structured page is enough. | One `data/own/<name>.md` (loose entry — no namespace folder). |

Default to **A** unless the operator says otherwise.

---

## 2. Identify the source type

Run `pnpm docs-import probe <url>` and read `result.kind`:

| `kind` | What it means | Next workflow |
|---|---|---|
| `openapi` | OpenAPI/Swagger spec found (URL in `openapiSpecUrl`). | **Workflow B (OpenAPI)** — call `docs-import openapi <specUrl>` and skip HTML entirely. |
| `llmstxt` | The site publishes its own `llms.txt`. `seedUrls` is the author's curated list. | **Workflow A** with `seedUrls` already populated. Trust them — they're hand-curated. |
| `sitemap` | Sitemap found, filtered to same-prefix URLs. | **Workflow A**. |
| `nav` | No sitemap; extracted from nav/sidebar. | **Workflow A** but expect noisier seeds; dedupe carefully. |
| `single` | No nav and no spec — probably one-page docs. | **Workflow C**. |

Don't try to detect manually. `probe` already does the candidate-URL probing and HTML inspection.

---

## 3. Workflow A — Crawl a multi-page docs site

### Discovery

`probe` already returned a `seedUrls` array. URLs are canonicalized and same-prefix-filtered for you. **Don't re-discover.**

If `seedUrls` is empty or just `[rootUrl]`, the probe couldn't find a usable nav/sitemap — treat as Workflow C.

### Crawl plan

- **BFS, depth ≤ 3.** Most doc sites are flat under a `/docs/` root.
- **Cap at 200 pages** by default. If you'd exceed this, stop and report — ask the operator to narrow scope (e.g. only a section).
- **Dedupe by canonical URL.** If the page has `<link rel="canonical">`, use that.
- **Throttle:** 200–500ms between requests to the same host.
- **Skip:** binary files (.pdf, .zip, images), social/login pages, search pages, changelogs older than 12 months, deprecated/legacy paths.

### Per-page extraction

For each URL in `seedUrls`:

```
pnpm docs-import fetch-clean <url>
```

stdout is clean markdown. **Exit 1 = the page failed the built-in sanity check** (too short, HTML leaked, no real content) — log the URL and skip. Don't try to "fix" failed pages.

Throttle yourself: 200–500ms between calls to the same host.

You don't need to do your own DOM filtering — `fetch-clean` already runs Readability + Turndown and discards nav/footer/marketing wrappers. Your only job per page is to pick a title and decide which entry it joins.

### Group into entries

Don't write one .md per crawled URL — that's noise. Group:

1. **By the site's own section structure.** If nav has groups ("Getting Started", "API Reference", "Guides"), one entry per group.
2. Within a group, concatenate pages in the order they appeared in nav, separated by `## <page title>` headings.
3. **Hard cap**: ~10k tokens per entry (~40k chars). If a group is bigger, split into `<group>-1.md`, `<group>-2.md`.
4. **Soft min**: don't produce entries under ~300 chars — merge into a sibling.

### Naming

- Namespace name: kebab-case slug of the product (e.g. `fastify`, `langchain`, `stripe-api`). Lowercase, no version unless they ship parallel docs (`react-19`).
- Entry files: `<group-slug>.md` (e.g. `getting-started.md`, `api-reference.md`, `guides-routing.md`).

---

## 4. Workflow B — OpenAPI / Swagger reference

When `probe` returned `kind: 'openapi'`, run:

```
pnpm docs-import openapi <openapiSpecUrl>
```

You get back JSON with this shape:

```
{ info, servers, securitySchemes, globalSecurity, tags: [{ name, description, endpoints: [...] }] }
```

Refs are already dereferenced. Endpoints are already grouped by `tags[0]`. **One markdown entry per tag.** Within an entry, one section per endpoint in the order returned.

### Endpoint template (use this exact shape for consistency)

````markdown
### `<METHOD> <path>` — <summary>

<description, plain prose, 1–3 sentences>

**Parameters**

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `id` | path | string | yes | The thing's id |
| `expand` | query | string[] | no | Related resources to inline |

**Request body**

```json
{
  "name": "string",
  "amount": 0
}
```

**Responses**

- `200` — <description>. Body:
  ```json
  { "id": "string", "name": "string" }
  ```
- `404` — Not found.

**Example**

```bash
curl -X POST https://api.example.com/v1/things \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"foo"}'
```
````

Skip the **Example** if the spec has no example values; do NOT invent realistic-looking ones.

### Auth section (once, in the namespace's llms.txt summary or a top-level `auth.md`)

Extract `securitySchemes` and document each (Bearer, API key, OAuth2 flows with scope list).

---

## 5. Workflow C — One page → one file

Simplest case. `pnpm docs-import fetch-clean <url>` → write stdout to `data/own/<slug>.md`. No namespace folder. Operator can link it from their master llms.txt later.

---

## 6. Write the namespace's `llms.txt`

After writing entries, generate the manifest at `data/own/<namespace>/llms.txt`:

```markdown
# <Product Name>

> <1–2 sentence summary. What is this? Who uses it? Pulled from the doc site's tagline or your own crisp restatement.>

> Source: <root URL>. Imported <YYYY-MM-DD>.

## <Section name>

- [<Entry title>](/api/entries/get?name=<namespace>/<file>.md): <one-line description>
```

Rules:
- **Title** = product name, not file name. E.g. `# Fastify`, not `# fastify-docs`.
- **Summary blockquote** = the elevator pitch + an "imported on" line so operators can spot staleness.
- **Sections** = mirror your entry grouping. Most namespaces have 1–4 sections.
- **Link path** = `/api/entries/get?name=<namespace>/<file>.md` (this is the URL the server exposes for own entries).
- **Description** = one line. What's in this entry, not "this entry contains…". E.g. `"Routing, middleware, hooks lifecycle"`.

---

## 7. Quality checklist (run before declaring done)

- [ ] `llms.txt` parses (valid H1, blockquote, sections, link list).
- [ ] Every link in `llms.txt` resolves to a file that exists.
- [ ] No entry under 300 chars (likely a stub).
- [ ] No entry over ~40k chars (split it).
- [ ] No HTML tags leaked into any `.md`.
- [ ] All code blocks have language hints where the source had them.
- [ ] No nav/footer/marketing fragments left ("Sign up for our newsletter", "© 2024", "Edit this page").
- [ ] No broken relative links (rewrite to absolute URLs of the source, or drop).
- [ ] Total namespace under ~100k chars. If bigger, the operator probably wants a narrower scope.

---

## 8. Things to ask the operator before starting

Don't assume — confirm:

1. **Output mode** (A / B / C from §1).
2. **Scope**: whole site, or one section (`/docs/api/...`)?
3. **Namespace name** if it's not obvious from the URL.
4. **Version handling**: if the site has versioned docs (`/v1/`, `/v2/`), which version(s)?
5. **Overwrite existing?** If `data/own/<namespace>/` exists, replace or merge?

---

## 9. Things NOT to do

- **Don't invent content.** If a page is sparse, leave it sparse. Don't fill gaps with plausible-sounding text.
- **Don't normalize prose style.** Keep the source's voice; you're an importer, not a copywriter.
- **Don't translate.** Keep the original language.
- **Don't include "AI summary" boilerplate.** Agents read these files — they don't need "This document explains…" preambles. Get straight to the content.
- **Don't follow outbound links during crawl.** Stay on-origin.
- **Don't recrawl on rerun.** Cache fetched HTML locally; only refetch pages whose ETag/Last-Modified changed.

---

## 10. Minimal pseudocode skeleton

```
function importDocs(url, mode):
  plan = shell("pnpm docs-import probe " + url)         # JSON
  namespace = operator.confirm(plan.suggestedNamespace)

  if plan.kind == "openapi":
    spec = shell("pnpm docs-import openapi " + plan.openapiSpecUrl)
    entries = spec.tags.map(tag => renderEndpointGroup(tag))
    writeAll(namespace, entries)
    writeManifest(namespace, spec.info, entries)
    return

  pages = []
  for url in plan.seedUrls:
    try:
      md = shell("pnpm docs-import fetch-clean " + url)
      pages.push({ url, md })
    except ExitCode1:
      log.warn("skipped: " + url)
    sleep(300ms)

  if mode == "C" or pages.length <= 1:
    write(`data/own/${namespace}.md`, pages[0]?.md ?? "")
    return

  groups = operator.confirm(suggestGrouping(pages))     # editorial step
  for g in groups: write(`data/own/${namespace}/${g.slug}.md`, concat(g.pages))
  if mode == "A": write(`data/own/${namespace}/llms.txt`, buildManifest(plan, groups))

  runQualityChecks(namespace)
  report({ fetched: plan.seedUrls.length, written: groups.length, skipped })
```

Note: `suggestGrouping` and the `operator.confirm` calls are where the local model earns its keep. The CLI handles the mechanical parts.
