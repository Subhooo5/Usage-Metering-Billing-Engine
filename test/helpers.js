process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder';

const crypto = require('crypto');
const { pool } = require('../src/db/pool');
const { createApp } = require('../src/http/app');
const tenantsRepo = require('../src/db/tenants');

async function startServer() {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function ensurePlan(id, apiCallLimit, tokenLimit) {
  await pool.query(
    'INSERT INTO plans (id, name, api_call_limit, token_limit) VALUES ($1, $1, $2, $3) ON CONFLICT (id) DO NOTHING',
    [id, apiCallLimit, tokenLimit]
  );
}

async function createTenant(planId = 'free') {
  const apiKey = `test-${crypto.randomUUID()}`;
  const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const tenant = await tenantsRepo.create(pool, { name: 'Test tenant', apiKeyHash, planId });
  return { tenant, apiKey };
}

async function generate(baseUrl, apiKey, idempotencyKey, tokens) {
  const headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers,
    body: JSON.stringify(tokens === undefined ? {} : { tokens })
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

async function countEvents(tenantId) {
  const { rows } = await pool.query('SELECT count(*)::int AS count FROM usage_events WHERE tenant_id = $1', [tenantId]);
  return rows[0].count;
}

async function seedEvents(tenantId, count) {
  await pool.query(
    `INSERT INTO usage_events (id, tenant_id, idempotency_key, request_hash, api_calls, total_tokens, cost_nano, response)
     SELECT gen_random_uuid(), $1, 'seed-' || n, 'seed', 1, 0, 0, '{}'::jsonb
     FROM generate_series(1, $2::int) AS n`,
    [tenantId, count]
  );
}

module.exports = { pool, startServer, ensurePlan, createTenant, generate, countEvents, seedEvents };