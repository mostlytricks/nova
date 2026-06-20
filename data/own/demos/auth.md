# Authentication

The Demo Orders API uses bearer token authentication. This file is the single home for auth details so endpoint pages do not repeat or drift.

## Scheme

Send the access token in the `Authorization` header:

```http
Authorization: Bearer <access_token>
```

Do not place tokens in query strings, request bodies, logs, examples, or generated test snapshots.

## Token source

In a real internal API doc set, this section must name the identity provider or token issuing flow from the source material. This demo intentionally uses a placeholder:

- Issuer: internal identity provider
- Token type: OAuth 2.0 access token
- Lifetime: 60 minutes
- Refresh: use the platform credential helper; do not implement a custom refresh flow unless the source docs require it

## Scopes

| Scope | Allows |
|---|---|
| `orders:read` | Read customers and orders |
| `orders:write` | Create and update customers and orders |
| `orders:cancel` | Cancel submitted orders |

Use the narrowest scope that satisfies the task.

## Implementation notes

Client code should centralize auth header injection. Tests should mock the token provider rather than hardcoding a token string. When troubleshooting `401` or `403` responses, check token expiry, missing scopes, and whether the token was issued for the correct API audience.
