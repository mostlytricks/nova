# Modification plan — docs split (post-import, opt-in)

## Goal

Some imported namespaces have too many links for small-context models to retrieve from well (e.g. a flat 1,360-link manifest). We want a way to slice a namespace into smaller "processed" sub-namespaces **without touching the original import**. Operator picks which version to point agents at; both can coexist.

## Design principles

- **Originals are immutable.** Splitting never modifies `data/own/<ns>/`. All output goes to sibling folders.
- **Splits are namespaces.** Each split is a full standalone namespace with its own `llms.txt` so the existing server / parser / dashboard work unchanged.
- **Derivation is visible.** Folder name encodes the parent (`<ns>--<slug>`) and the manifest carries a provenance blockquote.
- **Operator-invoked, not automatic.** No surprise side effects at import time. Import → inspect → decide to split.
- **Idempotent.** Re-running the split overwrites the same sibling folders. Original stays untouched.

## File layout

Before split:

```
data/own/
  langchain/
    llms.txt              ← original manifest, ~1,360 links
    <topic>.md ...        ← original entry files
```

After `pnpm docs-import split langchain`:

```
data/own/
  langchain/              ← UNCHANGED
    llms.txt
    <topic>.md ...
  langchain--core/        ← split: one section / path group
    llms.txt
    <topic>.md ...
  langchain--integrations/
    llms.txt
    ...
  langchain--expression-language/
    llms.txt
    ...
  langchain--split/       ← thin index pointing at all the slices
    llms.txt
```

`--` as separator is safe under existing `NAMESPACE_RE` (`/^[a-z0-9][a-z0-9_-]{0,63}$/i`).

## CLI shape

New subcommand on the existing `docs-import` CLI (no new binary).

```
pnpm docs-import split <namespace> [--by <strategy>] [--dry-run]

  <namespace>     existing namespace under data/own/
  --by sections   (default) use the H2 sections from <ns>/llms.txt
  --by path       group links by the first URL path segment after the doc root
  --by manual     emit a JSON plan to stdout for the operator to edit and pipe back
  --dry-run       print the proposed grouping and counts, write nothing

Output: writes <namespace>--<slug>/ folders + <namespace>--split/llms.txt
Exit 1 if the namespace doesn't exist or the strategy produces no groups.
```

For `--by manual`, the round-trip is:

```bash
pnpm docs-import split langchain --by manual > plan.json
# operator edits plan.json: rename groups, move links between groups
pnpm docs-import split langchain --by manual --plan plan.json
```

## Strategy details

### `--by sections` (default)

1. Parse `data/own/<ns>/llms.txt`.
2. Each H2 section becomes one split. Slug = kebab-case of the section name (`API Reference` → `api-reference`).
3. Each split's `llms.txt` contains:
   - Title: `<original title> — <section name>` (e.g. `LangChain — Integrations`)
   - Summary: original summary
   - Note: `> Note: derived from \`<ns>\` (full). Split by section. Generated <YYYY-MM-DD>.`
   - One H2 (the section's name), with the section's links.
4. Entry `.md` files: links that point at `/api/entries/get?name=<ns>/<file>.md` are rewritten to `/api/entries/get?name=<ns>--<slug>/<file>.md` AND the `.md` file is copied to the split's folder. External-URL links are kept as-is (no copy).

Edge cases:
- Section with one link → still gets its own split (don't merge — operator can delete later).
- Section name collides with a reserved namespace word (`api`, `static`, `llms.txt`, `assets`) → append a numeric suffix.
- Multiple sections produce the same slug → numeric suffix.

### `--by path`

1. For every link in the manifest, parse the URL.
2. Group by first path segment after the doc root (e.g. `/docs/guides/x` and `/docs/guides/y` → group `guides`).
3. Same per-group output as `--by sections`.
4. Useful when the source's H2 sections are flat / unhelpful (one big `## Pages` with 1000 links).

### `--by manual`

1. Without `--plan`: emit JSON shaped as `{ "groups": [ { "slug": "...", "title": "...", "linkUrls": [...] } ] }`. Default grouping = sections.
2. With `--plan plan.json`: read the file, validate, apply.

## The `<ns>--split` index

Single thin manifest that lists every split as a section. Lets the operator (and agents) discover them without scanning `data/own/`.

```markdown
# LangChain (split)

> Split slices of `langchain`, grouped by section. Each link below is a self-contained namespace.

> Note: derived from `langchain` (full). Generated 2026-05-24.

## Slices

- [LangChain — Core](/langchain--core/llms.txt): 84 links
- [LangChain — Integrations](/langchain--integrations/llms.txt): 612 links
- [LangChain — Expression Language](/langchain--expression-language/llms.txt): 53 links
- [LangChain — Guides](/langchain--guides/llms.txt): 211 links
- ...
```

## Master `llms.txt` interaction

Both the original (`langchain`) and the split index (`langchain--split`) appear in the master. Operator distinguishes them with operator notes (the existing `> Note: ...` blockquote feature):

```
- [LangChain (full)](/langchain/llms.txt): full manifest, 1360 links — prefer when running on 1M+ context
- [LangChain (split)](/langchain--split/llms.txt): split into 9 slices — prefer for smaller-context models
```

No new master-side logic needed; existing `generateMasterDoc` already walks all namespaces and appends operator notes.

## What the implementation touches

| File | Change |
|---|---|
| `server/bin/docs-import.ts` | New `split` subcommand. Reads `data/own/<ns>/llms.txt`, computes groups, writes sibling folders. |
| `server/own.ts` | No code change required (splits ARE namespaces). Optionally add `isSplitOf(name)` helper for UI hints. |
| `server/parser.ts` | No change. Existing `note` blockquote already covers provenance. |
| `ui/components/Dashboard.tsx` | (Optional, later) badge splits with `← split of langchain` link back to the parent. |

## What this plan deliberately does NOT do

- **No auto-split at import time.** Operator opts in per-namespace.
- **No deletion of originals.** Ever. Operator removes manually if they want to.
- **No content rewriting beyond link-URL rewriting** in `<topic>.md` files (and only if those files use the `/api/entries/get?name=...` URL pattern that points at the original namespace).
- **No cross-split deduplication.** A `.md` file referenced by two sections gets copied into both splits. Disk is cheap; the simplicity matters more.
- **No "split-of-a-split."** Splits are leaf nodes. If a slice is still too big, the operator can re-import differently or split manually.

## Open questions to settle before implementing

1. **Entry copy vs symlink.** Copy is simpler and Windows-friendly. Splits become self-contained at the cost of disk. Default: copy.
2. **What happens to entries not referenced by any link?** Likely orphans from a sloppy manifest. Default: leave in original only; don't copy into any split. Log them.
3. **Re-running `split` after the original has new entries.** Should we detect drift and warn? Default for v1: just overwrite splits silently; operator owns the cadence.
4. **UI surface for splitting.** Probably a "Split…" button on the namespace card that runs the CLI via a new endpoint. Out of scope for the CLI-first slice; add later if useful.

## Rollout

1. CLI subcommand + tests on a real namespace (langchain).
2. Verify split namespaces serve correctly via `GET /<ns>--<slug>/llms.txt` and entries resolve.
3. Verify master listing shows both with operator notes.
4. Document in `docs/agent-guide.md` (one paragraph: "after import, optionally `pnpm docs-import split <ns>` to chunk large manifests").
5. (Later) Dashboard surface — split button, parent/child relationship in the UI.
