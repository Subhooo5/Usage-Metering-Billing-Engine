const config = require('../config');
const stripe = require('./stripe');
const { HttpError } = require('../errors');

async function createCheckoutSession(tenant) {
  if (!config.stripe.secretKey || !config.stripe.proPriceId) {
    throw new HttpError(503, 'billing_not_configured', 'Stripe is not configured on this server.');
  }
  
  if (tenant.plan_id === 'pro') {
    throw new HttpError(409, 'already_pro', 'This tenant is already on the Pro plan.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: config.stripe.proPriceId, quantity: 1 }],
    client_reference_id: tenant.id,
    subscription_data: { metadata: { tenant_id: tenant.id } },
    success_url: `${config.baseUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.baseUrl}/billing/cancel`,
    ...(tenant.stripe_customer_id ? { customer: tenant.stripe_customer_id } : {})
  });

  return { id: session.id, url: session.url };
}

module.exports = { createCheckoutSession };