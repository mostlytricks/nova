# Overview

This is an example **namespace**: a folder under `data/own/` that contains its own `llms.txt` plus the markdown docs it references.

## Why namespaces?

- Each set of docs (one library, one API, one project) gets its own self-contained manifest.
- Agents can be pointed at `/<namespace>/llms.txt` for a focused view.
- The master `/llms.txt` indexes every namespace.

## Editing

- Edit this file freely in the UI or directly on disk at `data/own/demos/overview.md`.
- Add new docs under `data/own/demos/` and link them from `data/own/demos/llms.txt`.
- Use the **Regenerate from namespaces** button on the master llms.txt to refresh the top-level index.
