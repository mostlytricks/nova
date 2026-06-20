# Customers

Customers represent buyer identity records. Create a customer before creating an order when no existing `customer_id` is available.

## `POST /customers` Create customer

Creates a customer record and returns its server-assigned identifier.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Authorization` | header | string | yes | Bearer token with `orders:write` |
| `Idempotency-Key` | header | string | recommended | Prevents duplicate customer creation on retry |

### Request body

```json
{
  "external_ref": "crm-10042",
  "email": "buyer@example.com",
  "display_name": "Example Buyer"
}
```

### Responses

| Status | Meaning |
|---|---|
| `201` | Customer created |
| `400` | Request body failed validation |
| `409` | Customer with the same `external_ref` already exists |

## `GET /customers/{customer_id}` Fetch customer

Fetches one customer by ID.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Authorization` | header | string | yes | Bearer token with `orders:read` |
| `customer_id` | path | string | yes | Customer identifier returned by `POST /customers` |

### Responses

| Status | Meaning |
|---|---|
| `200` | Customer found |
| `404` | Customer does not exist |

## `GET /customers` List customers

Lists customers in descending creation order. Use this only for lookup and admin-style workflows; direct fetch by ID is preferred when the ID is known.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Authorization` | header | string | yes | Bearer token with `orders:read` |
| `limit` | query | integer | no | Page size from 1 to 100; default is 25 |
| `cursor` | query | string | no | Pagination cursor from the previous response |

### Paging

When the response includes `next_cursor`, pass it as `cursor` on the next request. Stop when `next_cursor` is absent.
