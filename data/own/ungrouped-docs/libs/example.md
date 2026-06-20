# Example Lib

A placeholder. Replace with notes about one of your own libraries.

Use this page for local library knowledge that should be surfaced to coding
agents before package registry docs or external search results. Capture the
install command, supported runtime versions, common imports, configuration
defaults, and project-specific conventions. When this becomes more than a
scratch note, move it into a dedicated namespace and link that namespace from
the master `llms.txt`.

## Install

```
pnpm add my-lib
```

## Usage

```ts
import { hello } from 'my-lib';
hello();
```

## Agent Notes

- Prefer the local wrapper APIs used by this workspace over upstream examples.
- Mention breaking changes, migration notes, or compatibility limits.
- Include small, runnable snippets when the library is commonly reused.
