const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { pool, startServer, createTenant, generate } = require('./helpers');
const config = require('../src/config');
const stripe = require('../src/services/stripe');

let context;

test.before(async () => {
  context = await startServer();
});

test.after(async () => {
  context.server.close();
  await pool.end();
});

function buildEvent(type, object, created = Math.floor(Date.now() / 1000)) {
  return { id: `evt_${crypto.randomUUID()}`, object: 'event', type, created, data: { object } };
}

function post(event, signature) {
  const payload = JSON.stringify(event);
  const header =
    signature || stripe.webhooks.generateTestHeaderString({ payload, secret: config.stripe.webhookSecret });
  return fetch(`${context.baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': header },
    body: payload
  });
}

async function planOf(tenantId) {
  const { rows } = await pool.query('SELECT plan_id, status FROM tenants WHERE id = $1', [tenantId]);
  return rows[0];
}

function checkoutEvent(tenantId, subscriptionId, created) {
  return buildEvent(
    'checkout.session.completed',
    { id: 'cs_test', mode: 'subscription', client_reference_id: tenantId, customer: 'cus_test', subscription: subscriptionId },
    created
  );
}

test('a forged signature returns 400 and changes nothing', async () => {
  const { tenant } = await createTenant();
  const event = checkoutEvent(tenant.id, `sub_${crypto.randomUUID()}`);
  const response = await post(event, 't=1,v1=forged');
  assert.equal(response.status, 400);
  assert.deepEqual(await planOf(tenant.id), { plan_id: 'free', status: 'active' });
});

test('a missing signature returns 400', async () => {
  const response = await fetch(`${context.baseUrl}/webhooks/stripe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(response.status, 400);
});

test('a valid checkout event flips the tenant to Pro, and a replay is ignored', async () => {
  const { tenant } = await createTenant();
  const event = checkoutEvent(tenant.id, `sub_${crypto.randomUUID()}`);

  const first = await post(event);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).duplicate, false);
  assert.deepEqual(await planOf(tenant.id), { plan_id: 'pro', status: 'active' });

  const second = await post(event);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).duplicate, true);

  const { rows } = await pool.query('SELECT count(*)::int AS count FROM stripe_events WHERE event_id = $1', [event.id]);
  assert.equal(rows[0].count, 1);
});

test('past_due blocks usage with 402, and deletion returns the tenant to Free', async () => {
  const { tenant, apiKey } = await createTenant();
  const subscriptionId = `sub_${crypto.randomUUID()}`;
  const base = Math.floor(Date.now() / 1000);

  await post(checkoutEvent(tenant.id, subscriptionId, base));

  await post(
    buildEvent('customer.subscription.updated', { id: subscriptionId, status: 'past_due', customer: 'cus_test', metadata: { tenant_id: tenant.id } }, base + 1)
  );
  assert.deepEqual(await planOf(tenant.id), { plan_id: 'pro', status: 'past_due' });
  const blocked = await generate(context.baseUrl, apiKey, 'pd-1');
  assert.equal(blocked.status, 402);
  assert.equal(blocked.body.error, 'payment_required');

  await post(
    buildEvent('customer.subscription.deleted', { id: subscriptionId, status: 'canceled', customer: 'cus_test', metadata: { tenant_id: tenant.id } }, base + 2)
  );
  assert.deepEqual(await planOf(tenant.id), { plan_id: 'free', status: 'active' });
});

test('an older event arriving late is ignored', async () => {
  const { tenant } = await createTenant();
  const subscriptionId = `sub_${crypto.randomUUID()}`;
  const base = Math.floor(Date.now() / 1000);

  await post(checkoutEvent(tenant.id, subscriptionId, base));
  await post(
    buildEvent('customer.subscription.deleted', { id: subscriptionId, status: 'canceled', customer: 'cus_test', metadata: { tenant_id: tenant.id } }, base + 10)
  );
  await post(
    buildEvent('customer.subscription.updated', { id: subscriptionId, status: 'active', customer: 'cus_test', metadata: { tenant_id: tenant.id } }, base + 5)
  );
  assert.deepEqual(await planOf(tenant.id), { plan_id: 'free', status: 'active' });
});

test('an event for an unknown tenant is acknowledged without errors', async () => {
  const event = buildEvent('customer.subscription.updated', {
    id: `sub_${crypto.randomUUID()}`,
    status: 'active',
    customer: 'cus_x',
    metadata: { tenant_id: 'not-a-uuid' }
  });
  const response = await post(event);
  assert.equal(response.status, 200);
});