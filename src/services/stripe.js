const Stripe = require('stripe');
const config = require('../config');

const stripe = new Stripe(config.stripe.secretKey || 'sk_test_missing');

module.exports = stripe;