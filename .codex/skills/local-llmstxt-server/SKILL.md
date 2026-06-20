---
name: local-llmstxt-server
description: Project-specific operating guide for this local-llmstxt-server repo. Use when Codex is asked to work on the current project, continue its roadmap, import or compose llms.txt namespaces, modify the docs-import CLI, handle CSR/SPA ingestion, add search or control-plane features, or answer "where are we" questions about this codebase.
---

# local-llmstxt-server

Use this skill only for this repository.

## First Reads

At the start of a project task, read these files in order:

1. `CONTEXT.md` - current state, dirty worktree expectations, next step.
2. `IMPLEMENTATION_PLAN.md` - durable roadmap and phase rules.
3. `MISSION.html` - product mission and non-negotiable design constraints.
4. `CLAUDE.md` - local project conventions, if relevant.

For ingestion/import work, also read:

- `SPEC.ingest-router.md` - input routing and CSR/SPA ladder.
- `SPEC.dev-docs-llms-txt.md` - output contract for good dev/API namespaces.
- `.claude/skills/docs-import/SKILL.md` - URL/CLI import procedure.
- `.claude/skills/llms-compose/SKILL.md` - local-material compose procedure.
- `.claude/skills/llms-txt-reader/SKILL.md` - selective manifest consumption procedure.

## Project Shape

- Runtime: Node 22+, TypeScript, pnpm 9.
- Server: Fastify in `server/index.ts`, route modules in `server/routes/`.
- UI: Vite + React in `ui/`.
- Import CLI: `server/bin/docs-import.ts`, invoked as `pnpm docs-import ...`.
- Own docs source: `data/own/`.
- Cache and SQLite are reproducible: `data/cache/`, `data/index.sqlite`.
- ESM local imports use `.js` extensions even when the source file is `.ts`.

## Core Rules

- Originals are immutable: do not mutate `data/own/<ns>/` while producing split/views unless the task explicitly edits that namespace.
- Views are namespaces: generated split outputs are sibling namespaces with their own `llms.txt`.
- External sources are human-curated: do not auto-promote trial sources to active.
- CLI first: build and verify core mechanics in `docs-import` before UI affordances.
- No formatter/linter churn: the repo has no formatter or linter configured.
- Respect dirty worktrees: do not revert user/unrelated changes.

## Verification

After code changes, run:

```bash
pnpm typecheck
```

Also manually exercise the affected path:

- CLI: run the specific `pnpm docs-import ...` command.
- API: fetch the relevant endpoint.
- UI: start `pnpm dev` and inspect the relevant view when frontend behavior changed.

`tsx`/esbuild may need an unsandboxed run because it spawns helper processes. If a command fails with `spawn EPERM`, rerun the same command with approval rather than changing code.

## Current Roadmap

Main phases 1-7 are done and committed. Phase 8 Search is queued.

Track R (Ingestion Router & CSR/SPA Handling) ran ahead of Phase 8:

- Increment 1 done: `probe` reports `rendering: 'ssr' | 'csr'` and `mdTwin`.
- Increment 2 done: `fetch-clean <url> --render` uses lazy Playwright Chromium and shared `htmlToMarkdown`.
- Increment 3 done: `llms-compose` was dry-run against the local Track R specs, the resulting `ingestion-router` namespace passed `pnpm docs-import check`, and the DRAFT marker was removed.

Always confirm this against `CONTEXT.md`; it is the freshest handoff.

## Ingestion Routing

For URL inputs:

1. Run `pnpm docs-import probe <url>`.
2. Check `rendering` first.
3. If `rendering: "csr"`, follow `SPEC.ingest-router.md`: markdown twin, then `fetch-clean --render`, then operator paste into `llms-compose`.
4. If `rendering: "ssr"`, branch by `kind`: `openapi`, `llmstxt`, `sitemap`, `nav`, or `single`.

For local material (pptx, PDF, pasted text, local markdown), use the `llms-compose` procedure and the dev-docs spec. Missing API metadata is a question, never an invention.

## Search Phase Guidance

When implementing Phase 8, start simple:

- Search `data/own/**/*.md`.
- Search namespace manifests.
- Search cached external markdown metadata.
- Add `GET /api/search?q=<query>`.
- Return title, namespace/source, snippet, and URL.

Do not add SQLite FTS or heavy indexing until basic search proves useful.
