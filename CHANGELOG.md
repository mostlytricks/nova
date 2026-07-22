# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions are anchored by annotated git tags `vX.Y.Z` — the tag plus `package.json`
`version` are the source of truth, never this file.

## [Unreleased]

### Changed
- **Project renamed `local-llmstxt-server` → `nova`** (NOVA — *Namespace Orchestrator for Verified Agent-docs*; alias declared 2026-07-06, rename executed 2026-07-22). GitHub repo already lived at `mostlytricks/nova`; this lands the rest: `package.json` name, doc identities (CLAUDE/README/MISSION/ARCHITECTURE/IMPLEMENTATION_PLAN), changelog link refs, and the workspace folder + junction. Old GitHub URLs redirect. The `.codex/skills/local-llmstxt-server/` skill folder keeps its name deliberately — workplace Codex discovers it by that slug; rename it only in step with the astra registry.

## [0.1.0] - 2026-07-06

First tagged release. Bundles the full 8-phase control plane, the ingestion
router (Track R), and the intranet-mirror / internal-manual track (Track M)
built to date.

### Added

- **Namespace docs-split CLI** — `docs-import split <ns>` turns an oversized namespace into focused sibling namespaces (`--by sections|path|manual`), never mutating the original.
- **Namespace health checks** — `docs-import check <ns>` / `--all` / `--json`: manifest validity, resolvable links, size/stub bounds, HTML-leak, orphans, and split recommendations. Shared by CLI and API.
- **Dashboard health signals** — `GET /api/health/namespaces[/:name]` plus UI badges surfacing what agents should read first and which namespaces are unhealthy or oversized.
- **Read-only agent view** — `GET /agent` + `/api/agent/index` with copy-paste manifest URLs and usage snippets.
- **Trust metadata for external sources** — owner, trust note, intended use, warning, last-reviewed, promotion reason; surfaced in source detail. See [walkthrough](docs/walkthroughs/2026-06-07-trust-metadata-and-refresh-history.md).
- **Snapshot & refresh history** — `GET /api/sources/:id/history` and `/api/links/:id/history` record upstream drift and changed content. See [walkthrough](docs/walkthroughs/2026-06-07-trust-metadata-and-refresh-history.md).
- **Write protection** — optional shared `WRITE_TOKEN` bearer guard on every mutating endpoint (`server/write-protect.ts`); reads stay open.
- **Search** — `GET /api/search?q=&limit=` and `docs-import search <q> [--json] [--limit N]`: ranked retrieval over own entries, namespace manifests, and cached active-source docs (`server/search.ts`).
- **Ingestion router + CSR/SPA handling (Track R)** — `docs-import probe` returns `rendering: ssr|csr` and detects markdown twins; `fetch-clean --render` adds an opt-in headless (Playwright) render rung; the 3-rung SPA ladder (twin → render → operator paste).
- **Clean per-doc URLs (Track M6)** — `/docs/<name>/llms.txt` + `/docs/<name>/<file>.md` for local namespaces and mirrored sources, with stable source slugs.
- **Reader + review UI (Track M7)** — a read-only doc-site reader over any `/docs/<name>/`, a review panel (Mark reviewed / Promote), the `link_missing_description` lint, and GFM table rendering.
- **Offline / intranet serving (Track M1)** — `?resolve=local` rewrites cached external links to this server's local cache so offline agents can use mirrored docs.
- **`llms-compose` skill** — compose a namespace from local material (pptx / xlsx / PDF / pasted text) via a metadata interview with a mandatory architecture checkpoint before any file is written.
- **`.gravity/` doc system** — mission / architecture / plan plus `ingest` and `namespace` domain SPECs, with `CLAUDE.md` as the router. Project alias `nova`.

[Unreleased]: https://github.com/mostlytricks/nova/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/mostlytricks/nova/releases/tag/v0.1.0
