# Agent Instructions

**`CLAUDE.md` is the canonical operating manual for this project.** Everything in this file is *routing*, not rules — do not duplicate project rules here; when stable instructions change, change `CLAUDE.md`.

## Required reading protocol — do this, in this order

1. **Before any work:** read `CLAUDE.md` (identity, stack, run/test commands, the doc router) **and** `CONTEXT.md` (current state + the single next step). Do not start without both.
2. **If a `.gravity/` directory exists:** read `.gravity/GRAVITY.md` — the protocol card explaining every doc kind under `.gravity/` and how to navigate them. Required before touching anything inside `.gravity/`.
3. **Before changing code in a domain:** read that domain's `.gravity/<domain>/SPEC.md` — the change contract. Find its path in `CLAUDE.md`'s Doc Map / router table; never guess paths.
4. **Before any cross-service or boundary change** (API shape, generated types, auth/session, ports, shared env, queues, data access): read `.gravity/integration/SPEC.md` first (or `CONTRACT.md` if that's what exists), then the affected domain SPECs.
5. **Before ending the session:** update `CONTEXT.md` (Completed / Current State / Next Step). A session that doesn't update it is incomplete.

## If instructions conflict

1. Higher-priority system/developer instructions.
2. Explicit user instructions in the current conversation.
3. This project's `CLAUDE.md` / `CONTEXT.md` (and, under `.gravity/`, the protocol card + domain SPECs).
