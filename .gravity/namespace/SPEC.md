# SPEC — namespace (output contract)

Canonical references: the [llmstxt.org spec](https://llmstxt.org/) (the format) and `../MISSION.html` §04 (the "originals immutable; namespaces are views" seam). This file is the **project-local contract** for what a *good dev/API* `llms.txt` namespace looks like — the requirements an authoring agent loads before composing one.

This is the compact, agent-loadable rule sheet for producing `data/own/<ns>/` documentation that this server serves to coding agents. Keep it short and checkable. The `docs-import` and `llms-compose` skills are the *procedures*; this is the *contract* both must satisfy. When they disagree with this file, this file wins.

Verified by hand today (no linter yet): run `pnpm docs-import check <ns>` after writing — it enforces most rules below (valid manifest, resolvable links, size/stub bounds, HTML leak, orphans). Treat a non-`healthy` result as a failing gate.

---

## Core Definition

A **Local Docs namespace** is one agent-ready documentation unit the server serves. It should describe a specific website, API, library, service, or product that agents may need to use. A valid namespace is:

- `data/own/<ns>/llms.txt` — the **manifest**: an H1 title, a one-line summary blockquote, a provenance line, and one or more `##` sections of link lines.
- One or more `<topic>.md` **entry files** the manifest links to — clean, normalized markdown holding the actual content.

The manifest is an *index for selection* (an agent reads it to decide *what to fetch*); entry files are the *payload*. A namespace is "good" when an agent can pick the right entry from the manifest alone and the fetched entry fits usefully in context.

## Local Docs Profiles

Choose one profile before composing files. If the material mixes profiles, split it into sibling namespaces unless the product is genuinely one integrated surface.

### Website / Product Docs

Use for a specific website, web app, SaaS console, internal tool, or documentation site. A strong website namespace usually has:

- `overview.md`: what the site/app is, audience, source/provenance, key domains.
- `navigation.md`: important routes/pages, entry points, and where tasks happen.
- `workflows.md`: common user or agent workflows in task order.
- `concepts.md`: domain objects and vocabulary.
- `integration-notes.md` or `caveats.md`: login/session behavior, environment assumptions, limitations, known traps.

Manifest sections should be task-oriented: `Start Here`, `Workflows`, `Reference`, `Caveats`. Link descriptions must say when an agent should fetch each page.

### API Docs

Use for REST, GraphQL, RPC, SDK-backed services, or internal APIs. A strong API namespace usually has:

- `overview.md`: product/API purpose, version, base URL, resource model, audience.
- `auth.md`: auth scheme documented exactly once.
- One resource file per meaningful resource/tag, such as `orders.md` or `customers.md`.
- `schemas.md` when shared objects are complex or reused across resources.
- `errors.md`: status codes, error shape, idempotency, rate limits, retry behavior.

Manifest sections should expose `Start Here` and `Reference`. Resource files should group endpoints by resource/tag, not emit one tiny file per endpoint.

`<ns>` matches `^[a-z0-9][a-z0-9-]*$` and may contain `--` (used for splits, e.g. `langchain--core`).

## Minimal Shape

A real, complete two-entry API namespace. Copy this shape:

````markdown
# Billing API

> Internal billing service — create invoices, record payments, query balances.

> Source: internal (Confluence "Billing API v2" + swagger). Imported 2026-06-20. Base URL: https://billing.corp.internal/v2. Auth: Bearer (see auth.md).

## Reference

- [Authentication](/api/entries/get?name=billing-api/auth.md): Bearer token scheme, scopes, token lifetime
- [Invoices](/api/entries/get?name=billing-api/invoices.md): create, fetch, void invoices; line-item shape
- [Payments](/api/entries/get?name=billing-api/payments.md): record and reconcile payments against invoices
````

Each entry file is plain markdown (see entry rules). Manifest link path is **exactly** `/api/entries/get?name=<ns>/<file>.md` for own entries.

## Manifest Rules

- **H1 = the product/API name**, not the namespace slug. `# Billing API`, not `# billing-api`.
- **Exactly one summary blockquote** directly under the H1: one to two sentences, what the thing *is* and what an agent can do with it. No marketing.
- **A provenance blockquote** (second `>` line): `Source: <origin>. Imported <YYYY-MM-DD>.` Get the date from the system — never hardcode. For dev/API docs, append `Base URL:` and `Auth:` here when known (or point to the auth entry).
- **One or more `## ` sections.** Section names mirror the content grouping (`Reference`, `Guides`, `Endpoints by Tag`, `Concepts`). Most namespaces have 1–4 sections.
- **Each link line:** `- [<Entry Title>](<url>): <one-line description>`.
  - Own entries → `/api/entries/get?name=<ns>/<file>.md`.
  - Pass-through / external docs → absolute `https://…` URL.
  - **Descriptions are required in this project.** The bare `- [title](url)` form (as adk.dev/llms.txt uses) is llmstxt.org-legal but banned here: the description is how an agent selects without fetching. One line, content-first (`"create, fetch, void invoices"`), never `"This entry contains…"`.
- ASCII punctuation only in generated files.

## Entry File Rules

- **Normalized markdown only.** No raw HTML tags (`<div`, `<script`, `<style`, `<nav`). No site chrome, cookie banners, "Edit this page", `© 2024`, newsletter CTAs.
- **Size bounds:** soft min ~300 chars (below that it's a stub — merge into a sibling); hard max ~40k chars (above that, split into `<topic>-1.md`, `<topic>-2.md`).
- **Code blocks carry a language hint** where known (` ```ts `, ` ```python `, ` ```json `, ` ```http `).
- **One concept per entry**, titled with a leading `# ` heading matching its manifest title.
- **Preserve the source's voice and language.** You are an importer/composer, not a copywriter. No AI-summary preambles ("This document explains…").

## Dev/API-Specific Requirements

These are what make API docs *usable* by an agent — the things slides and prose often omit:

- **Base URL / servers** must appear (manifest provenance line or the auth entry). An agent cannot call an API it can't address.
- **Auth documented exactly once**, in its own `auth.md` or the top of the manifest: scheme (Bearer / API key / OAuth), where the credential goes (header/query), scopes, and token lifetime if known. Link to it; don't repeat it per endpoint.
- **Endpoint entry shape** — for each endpoint within a tag/group:
  - `## ` heading: `` `<METHOD> <path>` `` followed by a short summary.
  - One to three sentences of description.
  - **Parameters** table: Name · In (path/query/header/body) · Type · Required · Description.
  - **Request body** with a real example **only if the source provides one**.
  - **Responses**: status code → description, with example payloads **only if present in the source**.
- **Group by resource/tag, not by URL noise.** One entry per resource (`Invoices`, `Payments`), endpoints as `##` sections inside it. Merge tags with only 1–2 endpoints rather than emit stub files.
- **Versioning is explicit.** If the API is versioned, the version belongs in the title or base URL — never leave an agent guessing which version it's reading.

## Required Metadata — and the Gaps to Fill

A good dev/API namespace needs the fields below. When the input (a pptx, a paste, a sparse page) doesn't supply one, **ask the operator — do not invent it.** This gap list is the spine of the `llms-compose` interview:

| Field | Lives in | Ask when missing |
|---|---|---|
| Product / API name | manifest H1 | always confirm |
| Local Docs profile | namespace metadata + authoring plan | ask whether this is `website`, `api`, `library`, or `notes` |
| One-line summary | summary blockquote | usually missing from raw material |
| Source / provenance + date | provenance blockquote | always (date is system; origin from operator) |
| Origin URL or source file | provenance blockquote or metadata | ask when source material came from a website, portal, file, deck, or paste |
| **Base URL / servers** | provenance or `auth.md` | often missing from slides — **ask** |
| **Auth scheme** | `auth.md` | often missing — **ask** |
| Version / environment | manifest provenance or `overview.md` | ask for API version, website environment, or product release when relevant |
| Section grouping | `##` headings | agent proposes, operator confirms |
| Per-entry descriptions | link lines | agent drafts from content |
| Intended use / audience / warnings | namespace metadata + operator note | always — **ask** |
| Known gaps | namespace metadata or `overview.md` caveat | ask what is intentionally missing or uncertain |

## Quality Gate

Before declaring a namespace done, all must hold (most are checked by `pnpm docs-import check <ns>`):

- [ ] `llms.txt` parses: H1, one summary blockquote, ≥1 section, ≥1 link line.
- [ ] Every manifest link resolves to a file that exists.
- [ ] No entry under ~300 chars (stub) or over ~40k chars (split it).
- [ ] No raw HTML tags and no marketing/chrome fragments in any entry.
- [ ] Every link line has a description.
- [ ] For APIs: base URL present, auth documented once, no invented example values.
- [ ] For websites/apps: important routes, workflows, login/session caveats, and domain concepts are represented.
- [ ] Metadata captures profile, intended use, owner/reviewer when known, warnings, and known gaps.
- [ ] No orphan `.md` files in the namespace that the manifest doesn't link.
- [ ] Provenance date is today's real date.

## Gotchas

- **Originals are immutable (MISSION §04).** Composing or splitting never edits the source namespace it derived from — emit a sibling. Never mutate `data/own/<ns>/` to fit a manifest.
- **The own-entry link path is literal:** `/api/entries/get?name=<ns>/<file>.md`. A wrong path silently 404s at fetch time, not at write time — `check` catches it, eyeballing does not.
- **Don't invent to fill a gap — ask.** A plausible-looking base URL or example payload is worse than an absent one; it makes an agent confidently wrong. This is the single rule that separates `llms-compose` from a hallucinating importer.
- **One auth home.** Auth repeated per endpoint drifts into N contradictory descriptions. Document once, link to it.
- **Descriptions are not optional here** even though the upstream spec allows omitting them — selection quality is the whole point of this server.

---

Procedures that satisfy this contract: the `docs-import` skill (URL/CLI ingestion) and the `llms-compose` skill (agent-read arbitrary material — pptx, paste, local files). The *why* behind the seam lives in `../MISSION.html`; the format authority is [llmstxt.org](https://llmstxt.org/).
