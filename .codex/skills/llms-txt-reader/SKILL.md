---
name: llms-txt-reader
description: Consume an llms.txt manifest from a URL (including this project's local-llmstxt-server) to ground answers in the right docs. Use when the user references an llms.txt, says "use the docs at X", points at a `/llms.txt` URL, asks you to consult their internal doc index, or names a known docs server. Supports http:// and https://, plus custom CA bundles for internal services.
---

# llms-txt-reader

You are reading documentation indexed by an `llms.txt` manifest. The manifest is small (title + summary + curated links); each link points to a longer markdown doc. Your job: **fetch the manifest, decide which links matter for the current task, fetch only those, ground your answer.**

## Format reminder (the [llmstxt.org spec](https://llmstxt.org/))

```markdown
# <Product Name>

> <one-paragraph summary>

> <optional extra context, more blockquote lines>

<optional free prose>

## <Section name>

- [<Title>](<url>): <one-line description>
- [<Title>](<url>): <one-line description>

## <Another section>
- ...
```

H1 is the title. First blockquote is the summary. H2s are sections. Each `- [title](url): desc` line is a link to a markdown doc (sometimes HTML — handle both).

## Tools

In priority order:

1. **`WebFetch`** — preferred for http:// and https://. Handles redirects, returns content.
2. **`Bash` with `curl`** — fallback when WebFetch refuses (some setups block http://), when you need custom headers, or when you must pass a CA bundle.

Never invent or reformat fetched content; quote/paraphrase from what you actually retrieved.

## Protocols

- **https://** — default. WebFetch.
- **http://** (plain) — common for internal services and `localhost`. Try WebFetch first; if it errors with a protocol/security message, fall back to `curl http://...` via Bash. Don't refuse http on principle — internal networks legitimately use it.
- **localhost / 127.0.0.1 / .local / internal hostnames** — assume plain http unless told otherwise.

## Custom CA certificates (internal services)

If the user's manifest URL serves over https with a private/internal CA (corporate proxy, internal PKI), the fetch will fail with a certificate error. Tell the user one of:

| Tool | How to trust the CA |
|---|---|
| **WebFetch / any Node tool** | Set env var `NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.pem` **before launching Claude Code**. |
| **curl** | Pass `--cacert /path/to/ca-bundle.pem`. |
| **System-wide (Windows)** | Import the CA into the Windows Trusted Root store via `certmgr.msc` — then WebFetch picks it up automatically. |
| **System-wide (Linux)** | Drop the cert in `/usr/local/share/ca-certificates/` and run `update-ca-certificates`. |

If you suspect a CA error, retry with curl using a verbose flag (`curl -v https://...`) so the user can see the actual cert chain failure, then point them at the table above. **Do NOT use `-k` / `--insecure` / disable cert verification** to "make it work" — that's a security regression. Ask the user.

## Step 1 — Identify the manifest URL

Common shapes the user gives you:

- `http://localhost:3000/agent/llms.txt` — this project's recommended agent entrypoint: Local Docs plus active Imported Docs
- `http://localhost:3000/llms.txt` — local-only master view
- `http://localhost:3000/<namespace>/llms.txt` — one Local Docs manifest (e.g. `/orders-api/llms.txt`)
- `http://localhost:3000/agent/sources/:id/llms.txt` — one active Imported Docs manifest
- `http://localhost:3000/llms.txt?merge=true` — legacy master + active imported docs, all in one
- `https://<some-site>/llms.txt` — a third-party doc index

If the user just says "use my llms.txt" with no URL, assume `http://localhost:3000/agent/llms.txt` for the broad recommended view. Use `http://localhost:3000/llms.txt` only when the task should ignore Imported Docs. Confirm if unsure.

## Step 2 — Fetch and parse

Fetch the manifest. Parse it in your head (it's just markdown):

- Pull the **H1 title** and the **blockquote summary**. These tell you what the doc set is about.
- Walk H2 sections; under each, collect the link list as `{ title, url, description }`.
- If a link's URL is relative (e.g. `/api/entries/get?name=foo.md`), resolve it against the manifest URL.

State the parsed shape briefly to the user once: e.g. *"Loaded `Fastify` (8 entries across 3 sections: Guides, Reference, Plugins)."* Don't dump the full link list — that's noise.

## Step 3 — Decide which links to follow

**This is the critical step. Do NOT fetch every link.** A typical manifest has 5–50 links totaling 100k+ chars — fetching all of them will blow your context and most of it won't be relevant.

Pick links by:

1. **Direct match**: link title or description contains a keyword from the user's question. (e.g. user asks about "routing" → fetch links whose title/description mentions routing.)
2. **Section relevance**: if a whole section is clearly the right scope ("Authentication" when asked about auth), prefer all links in that one section over scattered picks.
3. **Cap**: aim for ≤5 fetched entries per task. If you genuinely need more, fetch in waves — answer with what you have, ask if the user wants you to go deeper.
4. **Fallback**: if nothing obviously matches, fetch the *first* entry in the most relevant-sounding section as a starting point and tell the user "this seemed closest — let me know if I should look elsewhere."

When in doubt **ask**, don't fetch speculatively. Each unnecessary fetch is wasted context.

## Step 4 — Fetch the entries

Same tools (WebFetch / curl). One at a time. If a fetch fails:

- 404 → manifest is stale; tell the user that link is broken.
- Cert error → see CA cert table above.
- Timeout / 5xx → retry once, then move on; report it.

## Step 5 — Ground your answer

- Quote or paraphrase from the fetched content. Don't fall back to training-data knowledge about the same library — the manifest's entries are what the user wants you to use.
- **Cite which entry you used**: e.g. *"From `Routing` (`/fastify/routing.md`): …"* — short, inline.
- If the fetched content doesn't actually cover the question, say so explicitly. Don't paper over gaps.

## Caching

Within a single session, cache the parsed manifest and any fetched entries in your working context — don't re-fetch the same URL twice. Across sessions, no caching is needed; the local server already handles freshness.

If a manifest you fetched earlier seems stale (links 404, content references old versions), refetch it once and tell the user.

## Hard rules

- **Don't bypass cert verification.** No `-k`, no `NODE_TLS_REJECT_UNAUTHORIZED=0`. If certs fail, ask the user to set `NODE_EXTRA_CA_CERTS` or `--cacert` properly.
- **Don't fetch every link.** Pick selectively per Step 3.
- **Don't summarize the manifest itself as the answer.** The manifest is an *index*; the actual content is in the entries. Fetch entries before answering substantive questions.
- **Don't mix sources silently.** If you used both the manifest's entries and your training knowledge, distinguish them.
- **Don't refuse http://** for internal/localhost URLs. Plain HTTP on a local network is normal.

## Quick examples

**User:** "Use my llms.txt to explain how routing works in fastify."
**You:** Fetch `http://localhost:3000/agent/llms.txt` → see `Local Docs` section → find `/fastify/llms.txt` link → fetch that → find `Routing` entry → fetch it → answer, citing the routing doc.

**User:** "Check https://corp-internal/docs/llms.txt — I added the CA already."
**You:** WebFetch the URL. If it works, proceed. If cert error, suggest `NODE_EXTRA_CA_CERTS=...` and ask user to relaunch Claude Code (env vars are set at process start; you can't change them mid-session).

**User:** "What's in my docs server?"
**You:** Fetch `http://localhost:3000/agent/llms.txt`, parse, report title + sections + entry count. Don't fetch any entries until the user asks a substantive question.
