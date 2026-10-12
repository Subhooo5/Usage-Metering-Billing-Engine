const express = require('express');
const { authenticate } = require('../middleware/auth');
const { createCheckoutSession } = require('../../services/billing');

const router = express.Router();

router.post('/billing/checkout', authenticate, async (req, res) => {
  const session = await createCheckoutSession(req.tenant);
  res.status(200).json(session);
});

router.get('/billing/success', (req, res) => {
  res.status(200).json({ message: 'Checkout complete. Your plan updates once Stripe confirms the payment.' });
});

router.get('/billing/cancel', (req, res) => {
  res.status(200).json({ message: 'Checkout cancelled. Your plan did not change.' });
});

module.exports = router;