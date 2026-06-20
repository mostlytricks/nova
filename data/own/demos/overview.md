# Overview

The Demo Orders API is a synthetic Local Docs example that models how an internal API should be prepared for coding agents. It is not a real service. Its purpose is to show the expected shape for a high-quality `llms.txt` manifest and the linked markdown pages behind it.

Use this doc set as the template when turning a specific website, API portal, OpenAPI file, Confluence page, or operator-provided internal note into Local Docs.

## API identity

| Field | Value |
|---|---|
| Product name | Demo Orders API |
| Version | v1 |
| Base URL | `https://orders.internal.example/v1` |
| Audience | Coding agents implementing integrations, tests, or client wrappers |
| Auth home | `auth.md` |
| Source type | Synthetic demo material |

## Resource model

The API exposes two primary resources:

- Customers: buyer identity records used by orders.
- Orders: purchase requests containing one or more line items.

Orders reference customers by `customer_id`. A customer can have many orders. Orders move through a small lifecycle: `draft`, `submitted`, `fulfilled`, or `cancelled`.

## Agent usage guidance

Read this overview first when the task is broad. For any implementation task, fetch `auth.md` once, then fetch only the resource page that matches the task. For example, a task about cancelling an order should use `orders.md` and does not need the customer creation details unless the task also creates customers.

Do not treat values in this demo as production credentials, production URLs, or proof that a real service exists. For real Local Docs, preserve the actual source wording and ask the operator before filling missing base URL, auth, or example payload details.
