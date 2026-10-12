# Evidence

Captured on 2026-10-12 against the running stack (`docker compose up --build -d`, API on localhost:3000, Postgres on port 5433). Stripe is in test mode only. Terminal output is shown as captured, except where a note says it was shortened.

Demo tenants: Alpha Corp (`demo-key-alpha`, moved to Pro by a test Checkout) and Beta Corp (`demo-key-beta`, Free).

## Metering

### 1. A billable action creates exactly one usage event, even under retries

First request:

```
curl -i -X POST localhost:3000/generate -H "x-api-key: demo-key-alpha" -H "Idempotency-Key: probe-1" -H "Content-Type: application/json" -d '{"tokens":{"input":1000,"output":500}}'
```

```
HTTP/1.1 201 Created
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 248
ETag: W/"f8-nldVHUjDHdiv+FG9Y5nf33rkeNU"
Date: Mon, 12 Oct 2026 14:41:31 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"eventId":"b393a4fd-4f2c-4150-b87c-dd32e8fdaefa","usage":{"apiCalls":1,"tokens":{"input":1000,"cachedInput":0,"output":500,"reasoning":0},"totalTokens":1500},"cost":{"nano":2500000,"usd":"0.002500"},"remaining":{"apiCalls":99997,"tokens":4942000}}
```

Second request, same key and same body. It must return the same eventId with the header `Idempotent-Replayed: true`:

```
curl -i -X POST localhost:3000/generate -H "x-api-key: demo-key-alpha" -H "Idempotency-Key: probe-1" -H "Content-Type: application/json" -d '{"tokens":{"input":1000,"output":500}}'
```

```
HTTP/1.1 201 Created
X-Powered-By: Express
Idempotent-Replayed: true
Content-Type: application/json; charset=utf-8
Content-Length: 248
ETag: W/"f8-tuqpYv5WkMxQ+TYWlcN7DuG81fk"
Date: Mon, 12 Oct 2026 15:03:13 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"cost":{"usd":"0.002500","nano":2500000},"usage":{"tokens":{"input":1000,"output":500,"reasoning":0,"cachedInput":0},"apiCalls":1,"totalTokens":1500},"eventId":"b393a4fd-4f2c-4150-b87c-dd32e8fdaefa","remaining":{"tokens":4942000,"apiCalls":99997}}
```

Number of usage events stored for that key:

```
docker compose exec db psql -U postgres -d metering -c "SELECT count(*) FROM usage_events WHERE idempotency_key='probe-1';"
```

```
 count 
-------
     1
(1 row)
```

### 2. Proof that double counting cannot happen

Automated tests (`npm test`, full output at the end of this file):

```
✔ same idempotency key twice creates exactly one usage event (57.075875ms)
✔ five parallel requests with one key create one usage event (20.923625ms)
✔ same key with a different payload is rejected with 409 (8.692917ms)
```

The database also enforces it: `UNIQUE (tenant_id, idempotency_key)` on `usage_events` (see the `\d usage_events` output in the data model section).

## Quotas

### 3. Usage is checked against the plan, and over-limit requests are rejected

Documented rule (DESIGN.md): a request is allowed when `used + requested <= limit`. Reaching exactly the limit is allowed, the next request is rejected, and requests are all-or-nothing.

Setup: Beta Corp (Free plan, limit 1,000 calls) was filled with 999 events.

```
docker compose exec db psql -U postgres -d metering -c "INSERT INTO usage_events (id, tenant_id, idempotency_key, request_hash, api_calls, total_tokens, cost_nano, response) SELECT gen_random_uuid(), (SELECT id FROM tenants WHERE name='Beta Corp'), 'bulk-' || n, 'bulk', 1, 0, 0, '{}'::jsonb FROM generate_series(1, 999) AS n;"
```

The 1,000th call (exactly the limit) is allowed. The response below is the stored replay of that call (`Idempotent-Replayed: true`, because `edge-1` was sent before). `remaining.apiCalls: 0` shows it was the call that landed exactly on the limit.

```
curl -i -X POST localhost:3000/generate -H "x-api-key: demo-key-beta" -H "Idempotency-Key: edge-1" -H "Content-Type: application/json" -d '{}'
```

```
HTTP/1.1 201 Created
X-Powered-By: Express
Idempotent-Replayed: true
Content-Type: application/json; charset=utf-8
Content-Length: 235
ETag: W/"eb-tFf5AMiMg0cysFJ+XcDVOLWcuJg"
Date: Mon, 12 Oct 2026 14:46:47 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"cost":{"usd":"0.001000","nano":1000000},"usage":{"tokens":{"input":0,"output":0,"reasoning":0,"cachedInput":0},"apiCalls":1,"totalTokens":0},"eventId":"fb4994a4-1e93-49fa-8701-64f5b4cceeb9","remaining":{"tokens":100000,"apiCalls":0}}
```

The next call is rejected:

```
curl -i -X POST localhost:3000/generate -H "x-api-key: demo-key-beta" -H "Idempotency-Key: edge-2" -H "Content-Type: application/json" -d '{}'
```

```
HTTP/1.1 402 Payment Required
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 171
ETag: W/"ab-eYIdoA3gmq4YXBSiJZPmpVOZTA8"
Date: Mon, 12 Oct 2026 14:46:59 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"upgrade_required","message":"Free plan monthly api_calls limit reached. Upgrade to Pro to continue.","metric":"api_calls","limit":1000,"used":1000,"requested":1}
```

Automated boundary tests:

```
✔ 999 of 1000 calls: the next call is allowed (0.65125ms)
✔ 1000 of 1000 calls: free plan gets 402 with a message (0.125458ms)
✔ 1000 of 1000 calls: pro plan gets 429 with Retry-After (0.828792ms)
✔ a token request larger than the remainder is rejected whole (0.067625ms)
✔ exact boundary on a paid plan: last call allowed, next is 429 (14.341ms)
✔ exact boundary on the free plan: call 1000 allowed, call 1001 is 402 (14.042583ms)
✔ parallel requests never exceed the quota (19.729041ms)
```

### 4. Correct status codes (429 / 402) with a message that explains why

- 402 on the Free plan: the `edge-2` response above (`upgrade_required`, with metric, limit, used and requested).
- 402 for an overdue payment and 429 for Pro are covered by tests:

```
✔ 1000 of 1000 calls: pro plan gets 429 with Retry-After (0.828792ms)
✔ past due tenants get 402 payment_required (0.10625ms)
✔ exact boundary on a paid plan: last call allowed, next is 429 (14.341ms)
```

Live 429 on a Pro tenant at exactly 100,000 calls (the response must include `Retry-After`):

```
docker compose exec db psql -U postgres -d metering -c "INSERT INTO tenants (name, api_key_hash, plan_id) VALUES ('Delta Corp', encode(sha256('demo-key-delta'::bytea), 'hex'), 'pro');"
docker compose exec db psql -U postgres -d metering -c "INSERT INTO usage_events (id, tenant_id, idempotency_key, request_hash, api_calls, total_tokens, cost_nano, response) SELECT gen_random_uuid(), (SELECT id FROM tenants WHERE name='Delta Corp'), 'bulk-' || n, 'bulk', 1, 0, 0, '{}'::jsonb FROM generate_series(1, 100000) AS n;"
curl -i -X POST localhost:3000/generate -H "x-api-key: demo-key-delta" -H "Idempotency-Key: pro-limit-1" -H "Content-Type: application/json" -d '{}'
```

```
HTTP/1.1 429 Too Many Requests
X-Powered-By: Express
Retry-After: 1673707
Content-Type: application/json; charset=utf-8
Content-Length: 174
ETag: W/"ae-bRCcAp47DB0rYsJZ0PRxut8gVqM"
Date: Mon, 12 Oct 2026 15:04:53 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"quota_exceeded","message":"Monthly api_calls quota reached. It resets on 2026-11-01T00:00:00.000Z.","metric":"api_calls","limit":100000,"used":100000,"requested":1}
```

## Cost calculation

### 5. Monthly usage rolls up into a cost figure per tenant

```
curl -s localhost:3000/usage -H "x-api-key: demo-key-alpha"
```

```
{"tenant":{"id":"371bcde7-ec90-48da-963c-888bbc216df3","name":"Alpha Corp"},"plan":{"id":"pro","name":"Pro"},"status":"active","period":{"start":"2026-10-01T00:00:00.000Z","end":"2026-11-01T00:00:00.000Z"},"apiCalls":{"used":3,"limit":100000,"remaining":99997},"aiTokens":{"used":58000,"limit":5000000,"remaining":4942000},"cost":{"nano":26000000,"usd":"0.026000"}}
```

The three events behind this total, priced with the pinned constants:

| Event | Tokens | Cost in nano-USD |
|-------|--------|------------------|
| gate-1: input 1,000, output 500 | 1,500 | 2,500,000 |
| pricing-proof: input 10,000, cached 40,000, output 2,000, reasoning 3,000 | 55,000 | 21,000,000 |
| probe-1: input 1,000, output 500 | 1,500 | 2,500,000 |
| Total (3 calls) | 58,000 | 26,000,000 |

This matches `/usage`: 3 calls, 58,000 tokens, 26,000,000 nano-USD, which is $0.026000. The stored rows confirm it:

```
docker compose exec db psql -U postgres -d metering -c "SELECT idempotency_key, api_calls, total_tokens, cost_nano FROM usage_events WHERE tenant_id = (SELECT id FROM tenants WHERE name='Alpha Corp') ORDER BY created_at;"
```

```
 idempotency_key | api_calls | total_tokens | cost_nano 
-----------------+-----------+--------------+-----------
 gate-1          |         1 |         1500 |   2500000
 pricing-proof   |         1 |        55000 |  21000000
 probe-1         |         1 |         1500 |   2500000
(3 rows)
```

### 6. AI token pricing handles cached input, reasoning tokens and output correctly

Pinned prices (nano-USD): API call 1,000,000, uncached input token 500, cached input token 125, output or reasoning token 2,000.

Worked example (input 10,000, cached 40,000, output 2,000, reasoning 3,000, one call):

| Part | Calculation | nano-USD |
|------|-------------|----------|
| Uncached input | 10,000 x 500 | 5,000,000 |
| Cached input | 40,000 x 125 | 5,000,000 |
| Output + reasoning | (2,000 + 3,000) x 2,000 | 10,000,000 |
| API call | 1 x 1,000,000 | 1,000,000 |
| Total | | 21,000,000 ($0.021000) |

Automated tests:

```
✔ mixed token categories give the exact pinned total (0.536291ms)
✔ total tokens counts every category once (0.571959ms)
✔ cached input is cheaper than fresh input (0.078791ms)
✔ reasoning tokens are billed as output tokens (0.046583ms)
✔ a request with no tokens costs one API call (0.046334ms)
✔ usage rollup matches the pinned pricing constants (4.159833ms)
```

Live response for that exact request (stored replay of the original call; `cost.nano` must be 21000000):

```
curl -i -X POST localhost:3000/generate -H "x-api-key: demo-key-alpha" -H "Idempotency-Key: pricing-proof" -H "Content-Type: application/json" -d '{"tokens":{"input":10000,"cachedInput":40000,"output":2000,"reasoning":3000}}'
```

```
HTTP/1.1 201 Created
X-Powered-By: Express
Idempotent-Replayed: true
Content-Type: application/json; charset=utf-8
Content-Length: 259
ETag: W/"103-8Fzr2GHcgdrqNtsAfXiMjCsGAk0"
Date: Mon, 12 Oct 2026 15:05:44 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"cost":{"usd":"0.021000","nano":21000000},"usage":{"tokens":{"input":10000,"output":2000,"reasoning":3000,"cachedInput":40000},"apiCalls":1,"totalTokens":55000},"eventId":"6eda3bfb-27b6-4b95-a941-dea48fe32bdf","remaining":{"tokens":4943500,"apiCalls":99998}}
```

### 7. Pricing constants are pinned in config

```
grep -n -A5 "pricing: Object.freeze" src/config.js
```

```
12:  pricing: Object.freeze({
13-    apiCallNano: 1000000,
14-    inputTokenNano: 500,
15-    cachedInputTokenNano: 125,
16-    outputTokenNano: 2000
17-  }),
```

## Stripe

### 8. Checkout works end to end in test mode

Alpha Corp after a test Checkout: `GET /usage` (shown in section 5) reports plan `pro`, limit 100,000 calls and 5,000,000 tokens, which are the Pro limits.

The Stripe event for the test payment (livemode false, test card 4242, subscription creation). Output shortened: email, receipt URL, customer id and card fingerprint removed.

```
{
  "id": "evt_3UPjgG2fVmBzG7em1uYjaDz5",
  "object": "event",
  "api_version": "2026-06-24.dahlia",
  "created": 1791813261,
  "data": {
    "object": {
      "id": "ch_3UPjgG2fVmBzG7em1X2hHPB5",
      "object": "charge",
      "amount": 1000,
      "currency": "usd",
      "description": "Subscription creation",
      "livemode": false,
      "paid": true,
      "payment_method_details": {
        "card": {
          "brand": "visa",
          "last4": "4242"
        },
        "type": "card"
      },
      "status": "succeeded"
    }
  },
  "livemode": false,
  "type": "charge.succeeded"
}
```

Clean Free to Pro run with a new tenant (Gamma Corp):

```
docker compose exec db psql -U postgres -d metering -c "INSERT INTO tenants (name, api_key_hash) VALUES ('Gamma Corp', encode(sha256('demo-key-gamma'::bytea), 'hex'));"
```

Before the Checkout (plan must be `free`):

```
curl -s localhost:3000/usage -H "x-api-key: demo-key-gamma"
```

```
{"tenant":{"id":"83408bfd-a4d6-4db4-a19e-8fe018a1941d","name":"Gamma Corp"},"plan":{"id":"free","name":"Free"},"status":"active","period":{"start":"2026-10-01T00:00:00.000Z","end":"2026-11-01T00:00:00.000Z"},"apiCalls":{"used":0,"limit":1000,"remaining":1000},"aiTokens":{"used":0,"limit":100000,"remaining":100000},"cost":{"nano":0,"usd":"0.000000"}}
```

Checkout was started with `curl -s -X POST localhost:3000/billing/checkout -H "x-api-key: demo-key-gamma"` and paid in the browser with the test card 4242 4242 4242 4242.

Events delivered by `stripe listen --forward-to localhost:3000/webhooks/stripe`:

```
2026-10-12 20:20:49   --> charge.succeeded [evt_3UPjgG2fVmBzG7em1uYjaDz5]
2026-10-12 20:20:49  <--  [200] POST http://localhost:3000/webhooks/stripe [evt_3UPjgG2fVmBzG7em1uYjaDz5]
```

After the Checkout (plan must be `pro`, limits 100,000 calls and 5,000,000 tokens):

```
curl -s localhost:3000/usage -H "x-api-key: demo-key-gamma"
```

```
{"tenant":{"id":"83408bfd-a4d6-4db4-a19e-8fe018a1941d","name":"Gamma Corp"},"plan":{"id":"free","name":"Free"},"status":"active","period":{"start":"2026-10-01T00:00:00.000Z","end":"2026-11-01T00:00:00.000Z"},"apiCalls":{"used":0,"limit":1000,"remaining":1000},"aiTokens":{"used":0,"limit":100000,"remaining":100000},"cost":{"nano":0,"usd":"0.000000"}}
```

### 9. Webhooks verify signatures, ignore duplicates, and update plan and status

Forged signature returns 400 and changes nothing:

```
curl -i -X POST localhost:3000/webhooks/stripe -H "Content-Type: application/json" -H "Stripe-Signature: t=1,v1=forged" -d '{}'
```

```
HTTP/1.1 400 Bad Request
X-Powered-By: Express
Content-Type: application/json; charset=utf-8
Content-Length: 80
ETag: W/"50-hFyxc/fhdr4nM7ZX8mP6S+XFfPY"
Date: Mon, 12 Oct 2026 14:48:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"invalid_signature","message":"Webhook signature verification failed."}
```

A real Stripe event replayed with the Stripe CLI is ignored the second time. The resend output is the event shown in section 8.

```
stripe events resend evt_3UPjgG2fVmBzG7em1uYjaDz5
docker compose logs api --since 1m | grep webhook_duplicate_ignored
```

```
api-1  | {"time":"2026-10-12T14:50:49.720Z","event":"webhook_duplicate_ignored","type":"charge.succeeded","eventId":"evt_3UPjgG2fVmBzG7em1uYjaDz5"}
```

Replay of a `checkout.session.completed` event (the event that changes the plan):

```
docker compose exec db psql -U postgres -d metering -c "SELECT event_id, type FROM stripe_events WHERE type = 'checkout.session.completed' ORDER BY received_at DESC LIMIT 1;"
stripe events resend EVENT_ID > /dev/null
docker compose logs api | grep EVENT_ID
docker compose exec db psql -U postgres -d metering -c "SELECT count(*) FROM stripe_events WHERE event_id = 'EVENT_ID';"
```

```
                 event_id                 |            type            
------------------------------------------+----------------------------
 evt_0d65f905-a58a-4017-b749-370100b42e3e | checkout.session.completed
(1 row)

 count 
-------
     0
(1 row)


```

Automated webhook tests (signed events built in the test):

```
✔ a forged signature returns 400 and changes nothing (44.769541ms)
✔ a missing signature returns 400 (1.381667ms)
{"time":"2026-10-12T14:52:37.338Z","event":"webhook_processed","type":"checkout.session.completed","eventId":"evt_34ce193d-f856-481c-ae4a-1a3730238e8f"}
{"time":"2026-10-12T14:52:37.341Z","event":"webhook_duplicate_ignored","type":"checkout.session.completed","eventId":"evt_34ce193d-f856-481c-ae4a-1a3730238e8f"}
✔ a valid checkout event flips the tenant to Pro, and a replay is ignored (10.40075ms)
✔ past_due blocks usage with 402, and deletion returns the tenant to Free (23.844667ms)
✔ an older event arriving late is ignored (10.873125ms)
✔ an event for an unknown tenant is acknowledged without errors (1.938292ms)
```

## Data model, tests and documentation

### 10. Database has tenants, plans, subscriptions and usage events, isolated per tenant

```
docker compose exec db psql -U postgres -d metering -c "\dt"
```

```
               List of relations
 Schema |       Name        | Type  |  Owner   
--------+-------------------+-------+----------
 public | alerts            | table | postgres
 public | jobs              | table | postgres
 public | notifications     | table | postgres
 public | plans             | table | postgres
 public | schema_migrations | table | postgres
 public | stripe_events     | table | postgres
 public | subscriptions     | table | postgres
 public | tenants           | table | postgres
 public | usage_events      | table | postgres
(9 rows)
```

Indexes and the idempotency constraint:

```
docker compose exec db psql -U postgres -d metering -c "\d usage_events"
```

```
                           Table "public.usage_events"
       Column        |           Type           | Collation | Nullable | Default 
---------------------+--------------------------+-----------+----------+---------
 id                  | uuid                     |           | not null | 
 tenant_id           | uuid                     |           | not null | 
 idempotency_key     | text                     |           | not null | 
 request_hash        | text                     |           | not null | 
 api_calls           | integer                  |           | not null | 1
 input_tokens        | bigint                   |           | not null | 0
 cached_input_tokens | bigint                   |           | not null | 0
 output_tokens       | bigint                   |           | not null | 0
 reasoning_tokens    | bigint                   |           | not null | 0
 total_tokens        | bigint                   |           | not null | 
 cost_nano           | bigint                   |           | not null | 
 response            | jsonb                    |           | not null | 
 created_at          | timestamp with time zone |           | not null | now()
Indexes:
    "usage_events_pkey" PRIMARY KEY, btree (id)
    "usage_events_tenant_id_idempotency_key_key" UNIQUE CONSTRAINT, btree (tenant_id, idempotency_key)
    "usage_events_tenant_time_idx" btree (tenant_id, created_at)
Check constraints:
    "usage_events_api_calls_check" CHECK (api_calls >= 0)
    "usage_events_cached_input_tokens_check" CHECK (cached_input_tokens >= 0)
    "usage_events_cost_nano_check" CHECK (cost_nano >= 0)
    "usage_events_input_tokens_check" CHECK (input_tokens >= 0)
    "usage_events_output_tokens_check" CHECK (output_tokens >= 0)
    "usage_events_reasoning_tokens_check" CHECK (reasoning_tokens >= 0)
    "usage_events_total_tokens_check" CHECK (total_tokens >= 0)
Foreign-key constraints:
    "usage_events_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES tenants(id)
```

Tenant isolation test:

```
✔ tenants cannot see each other usage (4.88175ms)
```

### 11. README, architecture diagram, setup instructions and required files

```
ls -1 README.md DESIGN.md capstone.yaml EVIDENCE.md BUILDLOG.md .env.example
```

```
ls: BUILDLOG.md: No such file or directory
.env.example
DESIGN.md
EVIDENCE.md
README.md
capstone.yaml
```

## Shared requirements

### Layered architecture (data, logic, HTTP)

```
find src -type f | sort
```

```
src/config.js
src/db/alerts.js
src/db/jobs.js
src/db/migrate.js
src/db/notifications.js
src/db/plans.js
src/db/pool.js
src/db/stripeEvents.js
src/db/subscriptions.js
src/db/tenants.js
src/db/usage.js
src/errors.js
src/http/app.js
src/http/middleware/auth.js
src/http/routes/billing.js
src/http/routes/generate.js
src/http/routes/health.js
src/http/routes/usage.js
src/http/routes/webhooks.js
src/http/schemas.js
src/http/validate.js
src/jobs/handlers.js
src/jobs/worker.js
src/logger.js
src/scripts/seed.js
src/services/billing.js
src/services/meter.js
src/services/period.js
src/services/pricing.js
src/services/quota.js
src/services/stripe.js
src/services/usage.js
src/services/webhooks.js
```

### Validation at the boundary (bad input gives a clean 4xx, never a 500)

```
✔ missing idempotency key and bad bodies return 400, never 500 (5.738583ms)
✔ missing or wrong API key returns 401 (1.752417ms)
✔ a forged signature returns 400 and changes nothing (44.769541ms)
```

### Background job with retries and a failure alert

The job is enqueued when usage crosses 80 percent or 100 percent of a quota:

```
✔ crossing 80 percent enqueues one usage alert job (10.478958ms)
✔ crossing 80 percent is detected once (0.8335ms)
```

Retry and failure demo (a job with no handler is retried with backoff, then fails and raises an alert):

```
docker compose exec db psql -U postgres -d metering -c "INSERT INTO jobs (type, payload, max_attempts) VALUES ('does_not_exist', '{}', 3);"
docker compose logs api --since 1m | grep -E "job_retry|ALERT_job_failed"
docker compose exec db psql -U postgres -d metering -c "SELECT kind, message FROM alerts;"
```

```
api-1  | {"time":"2026-10-12T15:11:50.162Z","event":"job_retry","jobId":"15","type":"does_not_exist","attempt":1,"delaySeconds":2}
api-1  | {"time":"2026-10-12T15:11:52.171Z","event":"job_retry","jobId":"15","type":"does_not_exist","attempt":2,"delaySeconds":4}
api-1  | {"time":"2026-10-12T15:11:56.186Z","event":"ALERT_job_failed","jobId":"15","type":"does_not_exist","error":"No handler for job type does_not_exist"}

    kind    |                        message                        
------------+-------------------------------------------------------
 job_failed | Job 8 of type does_not_exist failed after 3 attempts
 job_failed | Job 15 of type does_not_exist failed after 3 attempts
(2 rows)
```

### Real persistence (migrations, indexes, isolated tenants)

```
ls migrations
```

```
001_init.sql    002_jobs.sql
```

The indexes are shown in the `\d usage_events` output in section 10.

### Idempotency where it matters

See sections 1 and 2.

### Cost tracked per call

AI usage is simulated, and no model is called. Every usage event stores its own cost (see the `cost` field in the responses in sections 1 and 3), and the monthly quota is the guard on spend (section 3).

### Secrets clean (env only, never committed)

Both commands must print nothing, before and after this file is committed:

```
git ls-files | grep -E "^\.env$"
git log --all -p | grep -E "sk_test_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|price_[A-Za-z0-9]{10,}"
```

```
+process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';
```

## Full test run

```
npm test
```

```
> metering-billing-engine@1.0.0 test
> node src/db/migrate.js && node --test test/pricing.test.js test/quota.test.js test/api.test.js test/webhook.test.js

◇ injected env (6) from .env
◇ injected env (4) from .env
✔ same idempotency key twice creates exactly one usage event (57.075875ms)
✔ five parallel requests with one key create one usage event (20.923625ms)
✔ same key with a different payload is rejected with 409 (8.692917ms)
✔ missing idempotency key and bad bodies return 400, never 500 (5.738583ms)
✔ missing or wrong API key returns 401 (1.752417ms)
✔ exact boundary on a paid plan: last call allowed, next is 429 (14.341ms)
✔ exact boundary on the free plan: call 1000 allowed, call 1001 is 402 (14.042583ms)
✔ parallel requests never exceed the quota (19.729041ms)
✔ usage rollup matches the pinned pricing constants (4.159833ms)
✔ tenants cannot see each other usage (4.88175ms)
✔ crossing 80 percent enqueues one usage alert job (10.478958ms)
◇ injected env (6) from .env
✔ mixed token categories give the exact pinned total (0.536291ms)
✔ total tokens counts every category once (0.571959ms)
✔ cached input is cheaper than fresh input (0.078791ms)
✔ reasoning tokens are billed as output tokens (0.046583ms)
✔ a request with no tokens costs one API call (0.046334ms)
✔ 999 of 1000 calls: the next call is allowed (0.65125ms)
✔ 1000 of 1000 calls: free plan gets 402 with a message (0.125458ms)
✔ 1000 of 1000 calls: pro plan gets 429 with Retry-After (0.828792ms)
✔ a token request larger than the remainder is rejected whole (0.067625ms)
✔ past due tenants get 402 payment_required (0.10625ms)
✔ crossing 80 percent is detected once (0.8335ms)
◇ injected env (4) from .env
✔ a forged signature returns 400 and changes nothing (44.769541ms)
✔ a missing signature returns 400 (1.381667ms)
{"time":"2026-10-12T14:52:37.338Z","event":"webhook_processed","type":"checkout.session.completed","eventId":"evt_34ce193d-f856-481c-ae4a-1a3730238e8f"}
{"time":"2026-10-12T14:52:37.341Z","event":"webhook_duplicate_ignored","type":"checkout.session.completed","eventId":"evt_34ce193d-f856-481c-ae4a-1a3730238e8f"}
✔ a valid checkout event flips the tenant to Pro, and a replay is ignored (10.40075ms)
{"time":"2026-10-12T14:52:37.346Z","event":"webhook_processed","type":"checkout.session.completed","eventId":"evt_21b18332-b558-4e6b-bd46-03c4c49bde23"}
{"time":"2026-10-12T14:52:37.351Z","event":"webhook_processed","type":"customer.subscription.updated","eventId":"evt_8f17918b-1b87-43e5-b7f2-4334cf3bb61d"}
{"time":"2026-10-12T14:52:37.365Z","event":"webhook_processed","type":"customer.subscription.deleted","eventId":"evt_222254f2-2053-4561-8468-bd098b06914e"}
✔ past_due blocks usage with 402, and deletion returns the tenant to Free (23.844667ms)
{"time":"2026-10-12T14:52:37.371Z","event":"webhook_processed","type":"checkout.session.completed","eventId":"evt_0d65f905-a58a-4017-b749-370100b42e3e"}
{"time":"2026-10-12T14:52:37.374Z","event":"webhook_processed","type":"customer.subscription.deleted","eventId":"evt_f4a1816d-9737-4e9f-9a37-be14dfad0a11"}
{"time":"2026-10-12T14:52:37.376Z","event":"webhook_processed","type":"customer.subscription.updated","eventId":"evt_4a6082d6-eb2c-4a8b-b133-5450d602763f"}
✔ an older event arriving late is ignored (10.873125ms)
{"time":"2026-10-12T14:52:37.378Z","event":"webhook_unknown_tenant","type":"customer.subscription.updated","eventId":"evt_194db2bc-d4b5-4cf7-b2ad-65941a2450ce"}
{"time":"2026-10-12T14:52:37.379Z","event":"webhook_processed","type":"customer.subscription.updated","eventId":"evt_194db2bc-d4b5-4cf7-b2ad-65941a2450ce"}
✔ an event for an unknown tenant is acknowledged without errors (1.938292ms)
ℹ tests 28
ℹ suites 0
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 376.826334
```