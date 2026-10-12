const { withTransaction } = require('../db/pool');
const stripeEventsRepo = require('../db/stripeEvents');
const subscriptionsRepo = require('../db/subscriptions');
const tenantsRepo = require('../db/tenants');
const { log } = require('../logger');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function planForStatus(status) {
  if (status === 'active' || status === 'trialing') {
    return { planId: 'pro', status: 'active' };
  }

  if (status === 'past_due' || status === 'unpaid') {
    return { planId: 'pro', status: 'past_due' };
  }

  if (status === 'canceled' || status === 'incomplete_expired') {
    return { planId: 'free', status: 'active' };
  }
  return null;
}

async function resolveTenantId(db, candidate, stripeSubscriptionId) {
  if (candidate && UUID.test(candidate) && (await tenantsRepo.exists(db, candidate))) {
    return candidate;
  }

  const existing = stripeSubscriptionId
    ? await subscriptionsRepo.findByStripeId(db, stripeSubscriptionId)
    : null;
  return existing ? existing.tenant_id : null;
}

async function isStale(db, stripeSubscriptionId, eventAt) {
  const existing = await subscriptionsRepo.findByStripeId(db, stripeSubscriptionId);
  return Boolean(existing && existing.last_event_at > eventAt);
}

async function checkoutCompleted(db, event) {
  const session = event.data.object;
  const eventAt = new Date(event.created * 1000);

  if (session.mode !== 'subscription' || !session.subscription || session.payment_status === 'unpaid') {
    return;
  }

  const tenantId = await resolveTenantId(db, session.client_reference_id, session.subscription);
  if (!tenantId) {
    log({ event: 'webhook_unknown_tenant', type: event.type, eventId: event.id });
    return;
  }

  if (await isStale(db, session.subscription, eventAt)) {
    return;
  }

  await subscriptionsRepo.upsert(db, {
    tenantId,
    stripeSubscriptionId: session.subscription,
    stripeCustomerId: session.customer,
    status: 'active',
    eventAt
  });

  await tenantsRepo.setPlan(db, tenantId, {
    planId: 'pro',
    status: 'active',
    stripeCustomerId: session.customer
  });
}

async function subscriptionChanged(db, event) {
  const subscription = event.data.object;
  const eventAt = new Date(event.created * 1000);
  const deleted = event.type === 'customer.subscription.deleted';
  const status = deleted ? 'canceled' : subscription.status;

  const tenantId = await resolveTenantId(
    db,
    subscription.metadata && subscription.metadata.tenant_id,
    subscription.id
  );

  if (!tenantId) {
    log({ event: 'webhook_unknown_tenant', type: event.type, eventId: event.id });
    return;
  }

  if (await isStale(db, subscription.id, eventAt)) {
    return;
  }

  await subscriptionsRepo.upsert(db, {
    tenantId,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: subscription.customer,
    status,
    eventAt
  });

  const outcome = planForStatus(status);
  if (outcome) {
    await tenantsRepo.setPlan(db, tenantId, { ...outcome, stripeCustomerId: subscription.customer });
  }
}

const handlers = {
  'checkout.session.completed': checkoutCompleted,
  'customer.subscription.updated': subscriptionChanged,
  'customer.subscription.deleted': subscriptionChanged
};

async function processStripeEvent(event) {
  return withTransaction(async (db) => {
    const fresh = await stripeEventsRepo.markProcessed(db, event);
    if (!fresh) {
      log({ event: 'webhook_duplicate_ignored', type: event.type, eventId: event.id });
      return { duplicate: true };
    }

    const handler = handlers[event.type];
    if (handler) {
      await handler(db, event);
    }
    
    log({ event: 'webhook_processed', type: event.type, eventId: event.id });
    return { duplicate: false };
  });
}

module.exports = { processStripeEvent };