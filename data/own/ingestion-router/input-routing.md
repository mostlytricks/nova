# Input Routing

`SPEC.ingest-router.md` is the front door for ingestion work. The output contract is always the same: a namespace under `data/own/<ns>/` that satisfies `SPEC.dev-docs-llms-txt.md`. Only the ingestion path changes.

Use `docs-import` when the input is a URL that the project CLI can fetch and parse. That includes documentation sites, OpenAPI or Swagger URLs, existing `llms.txt` manifests, sitemaps, navigation pages, and single server-rendered pages. The CLI does the fetching and parsing; the agent makes editorial decisions around grouping, descriptions, trust, and whether the result is agent-ready.

Use `llms-compose` when the input is local material the agent reads directly. Examples include pptx decks, PDFs, pasted text, clipboard content, local markdown, local text files, screenshots of tables, and other material with no fetchable URL. The composing agent reads the material, extracts only what is present, asks for missing metadata in a batched interview, and writes the namespace.

For URL input, run:

```bash
pnpm docs-import probe <url>
```

Branch on the probe result:

| Probe result | Route |
|---|---|
| `kind=openapi` | `docs-import` OpenAPI workflow |
| `kind=llmstxt` | `docs-import` using the discovered manifest and seed URLs |
| `kind=sitemap` or `kind=nav` with `rendering=ssr` | `docs-import` crawl workflow |
| `kind=single` with `rendering=ssr` | `docs-import` single-page workflow |
| `rendering=csr` | CSR/SPA ladder |

CSR/SPA pages need special handling because the useful content is not in static HTML. A plain static fetch can produce an empty shell, so `rendering=csr` is a branch, not an error.

Follow the CSR/SPA ladder in this order:

1. Prefer the markdown twin when `probe.mdTwin` is set. Fetch the twin with `fetch-clean <mdTwin>` and treat it like server-rendered content.
2. If no twin is available, use headless rendering with `pnpm docs-import fetch-clean <url> --render`. Add `--wait-for <selector>` when the page needs a specific rendered element before extraction.
3. If rendering is unavailable or fails, ask the operator to open the page in a real browser and paste the rendered content into `llms-compose`.

Mixed inputs keep the same lanes. A deck plus a Swagger URL should use `docs-import openapi` for the spec and `llms-compose` for the deck or prose material, then merge into one namespace that still satisfies the output contract.
