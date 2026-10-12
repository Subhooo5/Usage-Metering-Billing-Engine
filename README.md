# Usage Metering & Billing Engine

A backend service that meters tenant usage exactly once, enforces plan quotas, calculates cost with AI-token pricing rules, and keeps plans in sync with Stripe (test mode only).

## Architecture

```
Client -> POST /generate (x-api-key, Idempotency-Key)
   -> auth -> validation (zod)
   -> MeterService.recordUsage            [transaction, tenant row locked]
        duplicate key?  -> return the stored response (no new event)
        quota check     -> over limit: 402 (Free) / 429 (Pro) / 402 (past_due)
        insert usage_event (cost computed once, integer nano-USD)
        crossed 80% / 100%? -> enqueue usage_alert job
   -> 201 { eventId, usage, cost, remaining }

GET /usage -> rollup(usage_events for the UTC month) -> { used, limit, cost }

Stripe Checkout (test mode) -> subscription created
Stripe -- signed webhook --> POST /webhooks/stripe
   verify signature (forged -> 400) -> dedupe by event id (replay -> ignored)
   -> update tenant plan / status

Worker (in process) -> jobs table (SKIP LOCKED) -> retries with backoff -> failure alert
```

Layers: `src/http` (routes, validation, auth) -> `src/services` (logic) -> `src/db` (SQL only).

## Run

Requirements: Docker, Node 20+ (only for running tests locally).

```
cp .env.example .env
docker compose up --build -d
docker compose exec api npm run seed
```

The seed creates two demo tenants (Free plan): `demo-key-alpha` and `demo-key-beta`. Tests: `npm test` (the db container must be running).

For Stripe, fill `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID_PRO` and `STRIPE_WEBHOOK_SECRET` in `.env` (Stripe test mode only), then run `stripe listen --forward-to localhost:3000/webhooks/stripe`.

## Plans

| Plan | API calls / month | AI tokens / month |
|------|-------------------|-------------------|
| Free | 1,000 | 100,000 |
| Pro | 100,000 | 5,000,000 |

The month is a UTC calendar month.

## Rules

- Idempotency: one `Idempotency-Key` per billable action. A retry returns the original response with `Idempotent-Replayed: true`. The same key with a different payload returns 409.
- Quota boundary: a request is allowed if `used + requested <= limit`. Reaching exactly the limit is allowed, the next request is rejected, and requests are all-or-nothing.
- Over quota: Free gets 402 `upgrade_required`, Pro gets 429 `quota_exceeded` with `Retry-After`, past-due tenants get 402 `payment_required`.
- Money: integer nano-USD (1e-9 dollar), never floats.

| Item | Price (nano-USD) |
|------|------------------|
| API call | 1,000,000 |
| Uncached input token | 500 |
| Cached input token | 125 |
| Output or reasoning token | 2,000 |

Token categories are disjoint: `input` means uncached input. Reasoning tokens are billed at the output price. Example: input 10,000, cached 40,000, output 2,000, reasoning 3,000, one call = 21,000,000 nano-USD = $0.021.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | /health | none | Health check |
| POST | /generate | x-api-key + Idempotency-Key | Dummy billable action (simulated tokens) |
| GET | /usage | x-api-key | Used, limit, remaining and cost for the month |
| POST | /billing/checkout | x-api-key | Create a Stripe Checkout session (test mode) |
| POST | /webhooks/stripe | Stripe signature | Plan and status sync |

Example:

```
curl -X POST localhost:3000/generate \
  -H "x-api-key: demo-key-alpha" -H "Idempotency-Key: demo-1" -H "Content-Type: application/json" \
  -d '{"tokens":{"input":1000,"output":500}}'
```

## Stripe

Test mode only. Handled events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Signatures are verified on the raw body, events are deduplicated by event id, and stale events are ignored. The database changes only through verified events.

## Cost tracking

AI usage is simulated (no model is called). Every event stores its cost, and the monthly quota acts as the budget guard.

## Limitations

- The job worker runs inside the API process, and a job left `running` after a crash is not recovered.
- Stale-event detection compares event timestamps at one-second resolution.
- No invoicing, proration or overage billing.
- Demo API keys are fixed and meant for local use only.