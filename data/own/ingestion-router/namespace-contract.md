# Namespace Output Contract

`SPEC.dev-docs-llms-txt.md` defines what this project means by a good developer or API documentation namespace.

A namespace is one agent-ready documentation unit served by the local server. It contains a manifest at `data/own/<ns>/llms.txt` and one or more linked markdown entry files. The manifest is an index for selection; entries are the payload an agent fetches after choosing the relevant link.

The namespace slug must match `^[a-z0-9][a-z0-9-]*$`. Split namespaces may contain `--`, such as `langchain--core`.

The manifest must have:

| Part | Rule |
|---|---|
| H1 | Product, API, or documentation name, not the namespace slug |
| Summary blockquote | One to two sentences saying what the namespace covers and what an agent can do with it |
| Provenance blockquote | `Source: <origin>. Imported <YYYY-MM-DD>.` plus base URL and auth details when known for APIs |
| Sections | One or more `##` sections grouped by resource, tag, guide, endpoint family, or concept |
| Link lines | `- [<Entry Title>](<url>): <one-line description>` |

Own-entry links use this literal path:

```text
/api/entries/get?name=<ns>/<file>.md
```

Descriptions are required for every manifest link. The upstream llms.txt format allows bare links, but this project does not, because the description is how an agent chooses what to fetch without reading every entry.

Entry files must be normalized markdown only. They should not contain raw site HTML, navigation chrome, cookie banners, newsletter calls to action, edit-page links, or generated preambles. Each entry starts with a `#` heading matching the manifest title and covers one resource or concept.

For API documentation, the contract adds stricter requirements:

| Requirement | Rule |
|---|---|
| Base URL or servers | Must appear in the manifest provenance line or an auth/reference entry when known |
| Auth | Document exactly once, including scheme, credential location, scopes, and token lifetime when known |
| Endpoint grouping | Group by resource or tag, not by noisy URL paths |
| Endpoint sections | Use headings like ``## `GET /invoices/{id}``` followed by a short summary |
| Parameters | Include a table with name, location, type, required, and description |
| Examples | Include request or response examples only when the source provides them |
| Versioning | Make version explicit in title or base URL when the API is versioned |

Missing metadata is a question, not a license to invent plausible values. The required metadata interview confirms product name, summary, provenance, base URL, auth, section grouping, and intended use or warnings.
