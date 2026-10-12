# Design: Usage Metering & Billing Engine

## Problem
For each tenant, record billable usage exactly once, enforce plan quotas honestly, turn usage into money correctly, and keep the plan in sync with Stripe test mode.

## Plans and quotas
| Plan | API calls / month | AI tokens / month |
|------|-------------------|-------------------|
| Free | 1,000 | 100,000 |
| Pro | 100,000 | 5,000,000 |

The month is a UTC calendar month.

## Data model
- plans(id, name, api_call_limit, token_limit)
- tenants(id, name, api_key_hash, plan_id, status, stripe_customer_id)
- subscriptions(tenant_id, stripe_subscription_id, status, last_event_at)
- usage_events(id, tenant_id, idempotency_key, request_hash, api_calls, token columns, total_tokens, cost_nano, response)
- stripe_events(event_id) for webhook deduplication
- jobs, notifications, alerts for the background alert job

Every query is scoped by tenant_id taken from the API key, so tenants never see each other's data.

## Metering and idempotency
One usage event per billable action. It carries both metered quantities: api_calls (always 1) and the four token counts.
UNIQUE (tenant_id, idempotency_key) is the backstop. The service locks the tenant row inside a transaction, so concurrent requests are serialised: the quota check and the insert are atomic.
A repeated key with the same payload returns the stored response with the header Idempotent-Replayed: true. The same key with a different payload returns 409.

## Quota rule
A request is allowed if used + requested <= limit, for both calls and tokens. Reaching exactly the limit is allowed; the next request is rejected. Requests are all-or-nothing.
- Free plan over quota: 402 upgrade_required
- Pro plan over quota: 429 quota_exceeded with Retry-After
- Tenant status past_due: 402 payment_required

## Cost rules (integer nano-USD, 1e-9 dollar)
| Item | Price in nano-USD |
|------|-------------------|
| API call | 1,000,000 |
| Uncached input token | 500 |
| Cached input token | 125 |
| Output or reasoning token | 2,000 |

Token categories are disjoint: input means uncached input. Reasoning tokens are billed at the output price. Cost is computed once per event and stored.

## API surface
- POST /generate (x-api-key, Idempotency-Key)
- GET /usage (x-api-key)
- POST /billing/checkout (x-api-key)
- POST /webhooks/stripe (Stripe signature)
- GET /health

## Layers
HTTP (routes, validation, auth) -> services (meter, quota, pricing, billing, webhooks) -> db (repositories, SQL only).

## Stripe sync
Payment truth lives at Stripe. The database changes only through signature-verified events, deduplicated by event id, with a stale-event guard on last_event_at.

## Non-goal
No invoicing, proration or overage billing in the core.