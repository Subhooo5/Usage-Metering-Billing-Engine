async function findByStripeId(db, stripeSubscriptionId) {
  const { rows } = await db.query(
    'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1',
    [stripeSubscriptionId]
  );
  return rows[0] || null;
}

async function upsert(db, { tenantId, stripeSubscriptionId, stripeCustomerId, status, eventAt }) {
  await db.query(
    `INSERT INTO subscriptions (tenant_id, stripe_subscription_id, stripe_customer_id, status, last_event_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (stripe_subscription_id) DO UPDATE
     SET status = EXCLUDED.status,
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, subscriptions.stripe_customer_id),
         last_event_at = EXCLUDED.last_event_at,
         updated_at = now()`,
    [tenantId, stripeSubscriptionId, stripeCustomerId || null, status, eventAt]
  );
}

module.exports = { findByStripeId, upsert };