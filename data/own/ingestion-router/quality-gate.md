# Quality Gate

Run the checker after composing or importing a namespace:

```bash
pnpm docs-import check <namespace>
```

Treat anything other than `healthy` as a failed gate unless the warning is intentionally accepted and reported. The checker validates the parts that are mechanical: manifest parsing, resolvable own-entry links, missing files, orphan entries, duplicate URLs, tiny entries, oversized entries, and raw HTML leak patterns.

The full quality gate also needs a human pass:

| Check | Expected result |
|---|---|
| Manifest shape | H1, summary blockquote, provenance blockquote, at least one section, at least one link |
| Link descriptions | Every manifest link has a content-first one-line description |
| Entry files | Every referenced entry exists and starts with a matching `#` heading |
| Entry size | No stub entries under about 300 characters and no oversized entries above about 40,000 characters |
| Markdown cleanliness | No raw HTML, page chrome, cookie banners, marketing fragments, or edit-page links |
| API base URL | Present when the namespace documents an API |
| API auth | Documented exactly once when applicable |
| Examples | No invented request or response examples |
| Orphans | No unlinked `.md` files in the namespace |
| Provenance date | Uses the real system date |

When `llms-compose` is used, the dry-run should prove that missing metadata is handled explicitly. The agent should ask for missing fields in one batched interview, or, when the operator says to proceed without answers, leave unsupported values out and report what remains unknown.

The checker does not replace the contract. It catches structural failures, but it cannot know whether a base URL was invented, whether examples came from the source, or whether the section grouping is useful to a coding agent.
