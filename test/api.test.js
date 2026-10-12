const test = require('node:test');
const assert = require('node:assert/strict');
const { pool, startServer, ensurePlan, createTenant, generate, countEvents, seedEvents } = require('./helpers');

let context;

test.before(async () => {
  context = await startServer();
  await ensurePlan('test_three', 3, 1000000);
  await ensurePlan('test_five', 5, 1000000);
});

test.after(async () => {
  context.server.close();
  await pool.end();
});

test('same idempotency key twice creates exactly one usage event', async () => {
  const { tenant, apiKey } = await createTenant();
  const tokens = { input: 100, output: 50 };
  const first = await generate(context.baseUrl, apiKey, 'key-1', tokens);
  const second = await generate(context.baseUrl, apiKey, 'key-1', tokens);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.headers.get('idempotent-replayed'), 'true');
  assert.deepEqual(second.body, first.body);
  assert.equal(await countEvents(tenant.id), 1);
});

test('five parallel requests with one key create one usage event', async () => {
  const { tenant, apiKey } = await createTenant();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => generate(context.baseUrl, apiKey, 'same-key', { output: 10 }))
  );
  assert.ok(results.every((result) => result.status === 201));
  assert.equal(await countEvents(tenant.id), 1);
});

test('same key with a different payload is rejected with 409', async () => {
  const { apiKey } = await createTenant();
  await generate(context.baseUrl, apiKey, 'key-2', { input: 1 });
  const second = await generate(context.baseUrl, apiKey, 'key-2', { input: 2 });
  assert.equal(second.status, 409);
  assert.equal(second.body.error, 'idempotency_key_reused');
});

test('missing idempotency key and bad bodies return 400, never 500', async () => {
  const { apiKey } = await createTenant();
  const missing = await generate(context.baseUrl, apiKey, null, { input: 1 });
  assert.equal(missing.status, 400);
  assert.match(missing.body.message, /Idempotency-Key/);

  const negative = await generate(context.baseUrl, apiKey, 'neg', { input: -5 });
  assert.equal(negative.status, 400);

  const unknown = await generate(context.baseUrl, apiKey, 'unk', { surprise: 1 });
  assert.equal(unknown.status, 400);

  const broken = await fetch(`${context.baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'Idempotency-Key': 'bad-json' },
    body: '{not json'
  });
  assert.equal(broken.status, 400);
});

test('missing or wrong API key returns 401', async () => {
  const none = await fetch(`${context.baseUrl}/usage`);
  assert.equal(none.status, 401);
  const wrong = await fetch(`${context.baseUrl}/usage`, { headers: { 'x-api-key': 'nope' } });
  assert.equal(wrong.status, 401);
});

test('exact boundary on a paid plan: last call allowed, next is 429', async () => {
  const { tenant, apiKey } = await createTenant('test_three');
  for (let i = 1; i <= 3; i += 1) {
    const result = await generate(context.baseUrl, apiKey, `edge-${i}`);
    assert.equal(result.status, 201);
  }
  const blocked = await generate(context.baseUrl, apiKey, 'edge-4');
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  assert.equal(await countEvents(tenant.id), 3);
});

test('exact boundary on the free plan: call 1000 allowed, call 1001 is 402', async () => {
  const { tenant, apiKey } = await createTenant('free');
  await seedEvents(tenant.id, 999);
  const last = await generate(context.baseUrl, apiKey, 'free-1000');
  assert.equal(last.status, 201);
  const blocked = await generate(context.baseUrl, apiKey, 'free-1001');
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.error, 'upgrade_required');
});

test('parallel requests never exceed the quota', async () => {
  const { tenant, apiKey } = await createTenant('test_five');
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) => generate(context.baseUrl, apiKey, `race-${i}`))
  );
  const allowed = results.filter((result) => result.status === 201).length;
  const rejected = results.filter((result) => result.status === 429).length;
  assert.equal(allowed, 5);
  assert.equal(rejected, 3);
  assert.equal(await countEvents(tenant.id), 5);
});

test('usage rollup matches the pinned pricing constants', async () => {
  const { apiKey } = await createTenant();
  await generate(context.baseUrl, apiKey, 'cost-1', { input: 10000, cachedInput: 40000, output: 2000, reasoning: 3000 });
  const response = await fetch(`${context.baseUrl}/usage`, { headers: { 'x-api-key': apiKey } });
  const usage = await response.json();
  assert.equal(usage.apiCalls.used, 1);
  assert.equal(usage.aiTokens.used, 55000);
  assert.equal(usage.cost.nano, 21000000);
  assert.equal(usage.cost.usd, '0.021000');
});

test('tenants cannot see each other usage', async () => {
  const a = await createTenant();
  const b = await createTenant();
  await generate(context.baseUrl, a.apiKey, 'iso-1', { input: 100 });
  const response = await fetch(`${context.baseUrl}/usage`, { headers: { 'x-api-key': b.apiKey } });
  const usage = await response.json();
  assert.equal(usage.apiCalls.used, 0);
  assert.equal(usage.aiTokens.used, 0);
});

test('crossing 80 percent enqueues one usage alert job', async () => {
  const { tenant, apiKey } = await createTenant('test_five');
  for (let i = 1; i <= 4; i += 1) {
    await generate(context.baseUrl, apiKey, `alert-${i}`);
  }
  const { rows } = await pool.query(
    "SELECT count(*)::int AS count FROM jobs WHERE type = 'usage_alert' AND payload->>'tenantId' = $1",
    [tenant.id]
  );
  assert.equal(rows[0].count, 1);
});