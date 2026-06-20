---
name: llms-compose
description: Compose an agent-ready llms.txt namespace from arbitrary local material you read yourself — pptx decks, pasted/clipboard text, PDFs, local markdown, or a mix — when there is no URL to import. Use when the user wants to turn internal API docs, a slide deck, a Confluence dump, or pasted spec text into a proper llms.txt under data/own/. The complement to docs-import (which handles URLs); this one centers on an interview that fills the metadata gaps raw material leaves behind.
---

# llms-compose

You are the "composing agent" that turns **arbitrary internal material you read directly** — slide decks, pasted text, PDFs, local files — into an agent-ready `llms.txt` namespace for this project. There is no URL and no crawler here: you are the reader.

**The contract you must satisfy is `SPEC.dev-docs-llms-txt.md` at the repo root. Read it before composing.** This skill is the *procedure*; that SPEC is the *requirements*. It also owns the quality gate.

## When this skill vs `docs-import`

`SPEC.ingest-router.md` is the authoritative front door; in short:

- **A URL** (doc site, swagger/OpenAPI URL, an existing `llms.txt`) → use **`docs-import`**. The CLI fetches and parses; don't do it by hand.
- **Local material with no fetchable URL** (pptx, pasted clipboard text, PDF, local `.md`, screenshots of an API table) → **this skill.** You read it yourself.
- **A CSR/SPA URL the CLI couldn't render** (`probe` returned `rendering: "csr"`, no `mdTwin`, and `--render` was unavailable or failed) → this skill, via the operator-paste rung: the operator opens the page in a real browser, copies the rendered text, and pastes it in. The static page source is useless here (it's an empty shell) — you need the *rendered* content.
- Mixed (a deck *plus* a swagger URL) → run `docs-import openapi` for the spec, compose the prose parts here, merge into one namespace.

## What you produce

Files in `data/own/<namespace>/`, exactly as `SPEC.dev-docs-llms-txt.md` defines:

- `llms.txt` — manifest (H1, summary blockquote, provenance line, `##` sections, link lines **with descriptions**)
- `<topic>.md` entry files — clean normalized markdown

The running server serves them at `GET /<namespace>/llms.txt` and `GET /api/entries/get?name=<namespace>/<file>.md`.

## Step 0 — Get the material in front of you

Identify each input and read it. You ARE allowed to parse here (unlike `docs-import`):

| Input | How to read it |
|---|---|
| **pptx** | `python -c "from pptx import Presentation; ..."` to dump slide text + tables. If `python-pptx` is missing, tell the operator `pip install python-pptx`. Read speaker notes too — API details often hide there. |
| **PDF** | Use the `Read` tool (it renders PDF pages). |
| **Pasted text** | The operator pastes directly, OR pull the clipboard yourself on Windows: `powershell -NoProfile -Command Get-Clipboard`. Confirm you captured it all before proceeding. |
| **Local `.md` / `.txt` / code** | `Read` them directly. |
| **Image of a table/diagram** | `Read` the image; transcribe faithfully, don't embellish. |

If material spans several inputs, gather them all before drafting — grouping decisions need the whole picture.

## Step 1 — Extract, don't invent

Pull out the real substance: endpoints, parameters, auth, base URLs, concepts, examples. Keep a running list of `{ title, content, kind }`. Note what's **present** and — critically — what's **absent** (no base URL on the slides? no auth section? no examples?). The gaps drive Step 2.

Preserve the source's wording. Do not smooth, translate, or add preambles (SPEC: Entry File Rules).

## Step 2 — The metadata interview (the heart of this skill)

Raw material rarely supplies everything a good dev/API `llms.txt` needs. Walk the **Required Metadata** table in `SPEC.dev-docs-llms-txt.md`, mark which fields the material already answers, and **ask the operator for the rest in one batched set of questions** — don't drip one at a time, and don't guess.

Always confirm or ask for:

1. **Namespace + product name** — propose a slug from the material; confirm. (H1 = product name, not slug.)
2. **One-line summary** — draft one from the content; ask the operator to confirm or correct.
3. **Provenance** — what's the origin string? (e.g. "internal — Billing API deck v2"). Date is today's system date, automatic.
4. **Base URL / servers** — *for any API*, ask if not in the material. An API entry without an address is not agent-ready.
5. **Auth scheme** — ask if not in the material: Bearer / API key / OAuth, where the credential goes, scopes.
6. **Intended use / audience / warnings** — ask. This feeds the source's trust metadata later (SPEC + MISSION §03 human-curated trust).
7. **Section grouping** — propose your grouping (by resource/tag); confirm before writing.

**Rule: a missing field is a question, never an invention.** A plausible-but-wrong base URL or example payload makes a downstream agent confidently wrong — the one failure this skill exists to prevent.

If the operator says "just go," fill only what the material truly supports, leave genuinely-unknown fields out (don't fabricate), and flag the omissions in your Step 5 report.

## Step 3 — Draft entries

Follow `SPEC.dev-docs-llms-txt.md` (Entry File Rules + Dev/API-Specific Requirements):

- **Group by resource/concept, not by slide or page.** One entry per resource (`Invoices`, `Payments`), or per concept for prose docs.
- **Size:** merge anything under ~300 chars into a sibling; split anything over ~40k chars.
- **For APIs:** one `auth.md`; per-endpoint `## `\`<METHOD> <path>\`` sections with a Parameters table; request/response examples **only if the source gave them**.
- Each entry starts with a `# ` heading matching its manifest title. Language hints on code blocks.

## Step 4 — Write manifest + entries

Write each `data/own/<namespace>/<topic>.md`, then `data/own/<namespace>/llms.txt` using the manifest template in `SPEC.dev-docs-llms-txt.md` (Minimal Shape). Every link line gets a description. Own-entry link path is literally `/api/entries/get?name=<namespace>/<file>.md`. Use today's real date.

## Step 5 — Quality gate

Run the project's checker — it enforces most of the SPEC:

```bash
pnpm docs-import check <namespace>
```

Treat anything other than `healthy` as a failing gate: fix it or report it explicitly. Then re-verify the SPEC **Quality Gate** checklist by eye (descriptions present, base URL present for APIs, no invented values, provenance date correct).

## Step 6 — Report back

```
Composed <namespace> from <inputs, e.g. "Billing API deck (pptx) + pasted auth notes">
  Entries written: <K>
  Manifest: data/own/<namespace>/llms.txt
  check: healthy | warnings: <…>
  Asked operator for: <fields you filled via interview>
  Left unknown (flagged, not invented): <fields the material + operator didn't supply>
```

Then offer the follow-ups: register it as a tracked source / set trust metadata / split if oversized.

## Hard rules

- **Read `SPEC.dev-docs-llms-txt.md` first; it wins on any conflict with this skill.**
- **Don't invent content — ask.** Missing field → question to the operator, never a fabricated value.
- **Originals are immutable.** Composing never edits a source namespace; emit into a fresh `data/own/<namespace>/`. If `<namespace>` exists, ask: replace or merge.
- **Don't normalize voice or translate.** You're a composer, not a copywriter.
- **Don't add AI-summary preambles.** Other agents read these files.
- **A URL belongs to `docs-import`, not here.** If the operator hands you a link, switch skills.

## Reference

- `SPEC.ingest-router.md` — the front door: which lane handles which input, and the SPA ladder.
- `SPEC.dev-docs-llms-txt.md` — the requirements + quality gate (canonical).
- `docs-import` skill — the URL/CLI sibling; shares the manifest template and gate.
- `MISSION.html` §03–§04 — human-curated trust + the immutable-originals seam.
- [llmstxt.org](https://llmstxt.org/) — the format authority.
