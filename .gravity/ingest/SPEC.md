# SPEC — ingest (front-door router)

Canonical references: `../namespace/SPEC.md` (what a good output is), and the `docs-import` / `llms-compose` skills (the two procedures). This file is the **front door**: given *any* input, it decides which lane handles it. Both skills load it first. Why this domain exists → `../MISSION.html` §04 (the immutable-originals seam).

The output contract is always the same — a namespace under `data/own/<ns>/` that satisfies `../namespace/SPEC.md`. Only the *ingestion path* differs.

**Gate:** `pnpm typecheck` (the probe/router is code) + manually re-run `pnpm docs-import probe <url>` on one SSR and one CSR page to confirm the `rendering` verdict routes to the right lane. Whether the *right* lane was chosen for a given input is `[review]` judgment.

## The two lanes

- **`docs-import`** — input is a **URL** the project CLI can fetch and parse. The CLI does the fetching/parsing; the agent makes editorial calls.
- **`llms-compose`** — input is **local material the agent reads itself** (pptx, PDF, pasted/clipboard text, local files), *or* a URL that defeated the CLI (a CSR/SPA with no markdown twin and no render path). The agent is the reader.

## Routing

```
INPUT
 ├─ not a URL (file / paste / pptx / pdf / text) ─────────────▶ llms-compose
 └─ a URL ─▶ pnpm docs-import probe <url>  ─▶ branch on the result:
       kind=openapi ───────────────────────────▶ docs-import (openapi workflow)
       kind=llmstxt ───────────────────────────▶ docs-import (use seedUrls as-is)
       kind=sitemap | nav  AND rendering=ssr ───▶ docs-import (crawl workflow)
       kind=single         AND rendering=ssr ───▶ docs-import (single-page)
       rendering=csr  ─────────────────────────▶ SPA ladder (below)
```

`probe` returns `rendering: 'ssr' | 'csr'` and `mdTwin: string | null`. `rendering=csr` means the real content is **not in the static HTML** — a plain `fetch-clean` will return an empty shell. Do not ignore it.

## SPA ladder (when `rendering=csr`)

Try the rungs in order; stop at the first that yields real content:

1. **Markdown twin.** If `probe.mdTwin` is set, the site already publishes a pre-rendered markdown version of the page (e.g. `/page.md`). Fetch it with `fetch-clean <mdTwin>` and treat as SSR. Cheapest, lossless — always prefer this.
   - Also check whether *every* route has a `.md` twin (many doc SPAs do). If so, append `.md` to each `seedUrl` and crawl those instead of the HTML routes.
2. **Headless render.** `pnpm docs-import fetch-clean <url> --render` runs the page in headless Chromium and cleans the rendered DOM. *(Increment 2 — optional Playwright dep; if `--render` reports the engine is unavailable, fall through.)*
3. **Operator paste.** Ask the operator to open the page in a real browser, use reader mode / select-all, and paste (or pipe the clipboard) into **`llms-compose`**. Zero deps, always works, manual. This is the floor of the ladder.

## Mixed inputs

A deck **plus** a swagger URL, or prose pages **plus** an OpenAPI spec: run each part through its lane (`docs-import openapi` for the spec, `llms-compose` for the deck), then merge into one namespace. The merge still has to satisfy `../namespace/SPEC.md` (one auth home, base URL present, descriptions on every link).

## Gotchas

- **`rendering=csr` is not an error — it's a branch.** Falling straight to `fetch-clean` on a CSR page silently produces junk (exit 1 at best, a thin shell at worst). Route to the ladder.
- **Prefer the twin over rendering over paste** — cheapest lossless path wins. Don't reach for Playwright if `mdTwin` is set.
- **A URL never auto-routes to `llms-compose` first.** Always `probe` it; only fall to the compose lane after the ladder is exhausted, so the CLI's structured plan (tags, seedUrls) isn't thrown away.
- **`probe` only flags CSR on HTML-fallback branches.** If `kind` is `openapi`/`llmstxt`/`sitemap`, rendering is reported `ssr` and is moot — those already have a structured plan.

---

Output requirements live in `../namespace/SPEC.md`. Procedures live in the `docs-import` and `llms-compose` skills. The *why* (immutable originals, human-curated trust) lives in `../MISSION.html`.
