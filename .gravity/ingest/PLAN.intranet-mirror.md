# ingest — PLAN.intranet-mirror

Status: ◑ building <!-- Track M (intranet deployment). Mirror into IMPLEMENTATION_PLAN.md → Tracks index + the `ingest` spine row. -->

> Carries **Track M — intranet deployment** (IMPLEMENTATION_PLAN.md → Tracks). Direction (→ `MISSION.html` §01): turn the built control plane into the thing it was for — **pay the pptx/excel/image parse cost once, serve clean markdown to every agent on the intranet.**

## Goal

Deploy the control plane on the real intranet host as two live use cases: **UC1** — mirror approved external `llms.txt` sources and serve them cache-resolved to offline agents; **UC2** — compose the most re-parsed internal manuals (pptx/excel) into reviewed `llms.txt` namespaces. Done when a fresh agent on a second machine answers real task questions from the served namespaces alone, offline.

Shipped so far: **M1** (`?resolve=local` cache-resolved serving), **M2** (compose architecture checkpoint + xlsx input), **M6** (clean `/docs/<name>/` per-doc URLs), **M7** (reader + review panel + lint). The remaining slice is the real-host deployment below.

## Scenario

- given an approved external `llms.txt` (e.g. `code.claude.com/llms.txt`) registered and refreshed on the real host, when an intranet agent with no internet fetches `/docs/<slug>/llms.txt` → every link resolves to a local `/api/links/:id/content` URL and the answer is served from cache alone.
- given a high-frequency internal manual (pptx + excel) composed through the `llms-compose` checkpoint flow and marked reviewed, when a fresh agent session is asked 3–5 real task questions → it answers them from the served namespace alone, with no re-parse.

## Slice

- **[M3 — UC1 pilot, real host]** repeat the sandbox-validated external mirror (163/163 pages, 0 errors) on the intranet host. If egress needs a proxy, run Node with `NODE_USE_ENV_PROXY=1` + `NODE_EXTRA_CA_CERTS=<ca-bundle>` (Node `fetch` ignores `HTTPS_PROXY` by default). Prefer `llms-full.txt` variants when a source publishes one (link caching is one level deep by design).
- **[M4 — UC2 pilot]** pick the internal manual set agents re-parse most (ideally a pptx + excel pair); prep interview answers up front (base URL, auth, version, audience, known gaps); run `llms-compose` through the checkpoint flow; pass `pnpm docs-import check`.
- **[M5 — governance]** before wide exposure: set `WRITE_TOKEN`; establish namespace naming/tag conventions per team or system; assign an owner + review cadence per namespace (`.meta.json` trust fields since Phase 5); keep everything `draft` until reviewed. Curation quality over volume.

## Verification

1. **M3 offline acceptance:** from a second machine with `llms-txt-reader`, no internet, look up a known fact (e.g. hooks → `PreToolUse`) via `/docs/<slug>/llms.txt` → answered from cache, 0 errors.
2. **M4 fresh-agent acceptance:** a new agent session answers 3–5 real task questions from the composed namespace alone; failures point at the entry/description to fix.
3. `pnpm typecheck` clean; `pnpm docs-import check <ns>` reports healthy (0 warnings).

## Open questions

- OPEN: which internal manual set is the highest-value first UC2 target (conversion value = parse-cost-per-query × queries-per-week)?
- OPEN: does the real intranet host need the egress proxy + CA bundle, or is direct egress available?

## Next

Run **M3 on the real host** — register the external source, verify the `?resolve=local` mirror with the offline acceptance test from a second machine. Then M4.

---

### Locked decisions (Track M residue — durable ingest/serving rules)

<!-- Graduated from Track M's decisions. Promote any that earn a named test into ingest/SPEC.md or namespace/SPEC.md — then drop it here. -->

- **Cache-resolved serving for intranet agents.** `?resolve=local` on `/agent/llms.txt`, `/agent/sources/:id/llms.txt`, and `/llms.txt?merge=true` rewrites cached links to `/api/links/:id/content`; uncached links keep their upstream URL.
- **`llms-compose` has a mandatory architecture checkpoint** — the agent presents the plan (inventory, profile, entry files, sections, gaps) and the operator confirms **before any file is written**.
- **Excel is a first-class compose input** (per-sheet dump → markdown tables).
- **Prioritize manuals by re-parse frequency** — convert the most-consulted material first.
- **Human review stays the accuracy gate** — `check` validates structure, not truth; composed namespaces stay `draft` until reviewed. Re-compose on manual change is a manual, reviewed event — never automated.
