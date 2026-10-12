const express = require('express');
const config = require('../../config');
const stripe = require('../../services/stripe');
const { processStripeEvent } = require('../../services/webhooks');

const router = express.Router();

router.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.get('stripe-signature'),
      config.stripe.webhookSecret
    );
  } 
  catch (error) {
    return res.status(400).json({ error: 'invalid_signature', message: 'Webhook signature verification failed.' });
  }

  const result = await processStripeEvent(event);
  res.status(200).json({ received: true, duplicate: result.duplicate });
});

module.exports = router;