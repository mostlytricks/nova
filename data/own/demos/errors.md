# Errors and limits

The Demo Orders API returns JSON error responses with a stable machine-readable code and a human-readable message.

## Error shape

```json
{
  "error": {
    "code": "validation_failed",
    "message": "One or more fields are invalid",
    "request_id": "req_123"
  }
}
```

Always preserve `request_id` in logs and support tickets. Do not expose bearer tokens or full request bodies in error logs.

## HTTP status codes

| Status | Meaning | Typical fix |
|---|---|---|
| `400` | Request validation failed | Check required fields, enum values, and item quantities |
| `401` | Missing or expired token | Fetch a fresh access token |
| `403` | Token lacks required scope | Request the narrow scope needed by the endpoint |
| `404` | Resource does not exist | Verify the customer or order ID |
| `409` | State or idempotency conflict | Fetch current resource state before retrying |
| `429` | Rate limit exceeded | Back off and retry after the indicated delay |
| `500` | Server error | Retry only if the operation is idempotent or uses an idempotency key |

## Idempotency

Create endpoints accept `Idempotency-Key`. Reusing a key with the same request body returns the original result. Reusing a key with a different request body returns `409`.

Use idempotency keys for retryable create operations. Do not use one shared key for unrelated requests.

## Rate limits

The demo limit is 600 requests per minute per client. When a response includes `Retry-After`, wait at least that many seconds before retrying.
