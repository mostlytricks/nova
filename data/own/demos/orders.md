# Orders

Orders represent purchase requests for one customer. An order contains one or more line items and moves through a lifecycle managed by the service.

## Order states

| State | Meaning |
|---|---|
| `draft` | Created but not submitted for fulfillment |
| `submitted` | Accepted and waiting for fulfillment |
| `fulfilled` | Fulfillment completed |
| `cancelled` | Cancelled before fulfillment |

Only `draft` and `submitted` orders can be cancelled.

## `POST /orders` Create order

Creates an order for an existing customer.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Authorization` | header | string | yes | Bearer token with `orders:write` |
| `Idempotency-Key` | header | string | recommended | Prevents duplicate order creation on retry |

### Request body

```json
{
  "customer_id": "cus_123",
  "currency": "USD",
  "items": [
    {
      "sku": "SKU-001",
      "quantity": 2,
      "unit_amount": 1299
    }
  ]
}
```

### Responses

| Status | Meaning |
|---|---|
| `201` | Order created |
| `400` | Request body failed validation |
| `404` | Customer does not exist |
| `409` | Duplicate idempotency key with a conflicting body |

## `GET /orders/{order_id}` Fetch order

Fetches one order by ID.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Authorization` | header | string | yes | Bearer token with `orders:read` |
| `order_id` | path | string | yes | Order identifier returned by `POST /orders` |

### Responses

| Status | Meaning |
|---|---|
| `200` | Order found |
| `404` | Order does not exist |

## `POST /orders/{order_id}/cancel` Cancel order

Cancels an order that has not been fulfilled.

### Parameters

| Name | In | Type | Required | Description |
|---|---|---|---|---|
| `Authorization` | header | string | yes | Bearer token with `orders:cancel` |
| `order_id` | path | string | yes | Order identifier |

### Request body

```json
{
  "reason": "buyer_request"
}
```

### Responses

| Status | Meaning |
|---|---|
| `200` | Order cancelled |
| `400` | Cancellation reason is invalid |
| `404` | Order does not exist |
| `409` | Order is already fulfilled or cancelled |
