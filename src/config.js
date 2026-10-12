require('dotenv').config();

const config = {
  port: Number(process.env.PORT) || 3000,
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  databaseUrl: process.env.DATABASE_URL,
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    proPriceId: process.env.STRIPE_PRICE_ID_PRO
  },
  pricing: Object.freeze({
    apiCallNano: 1000000,
    inputTokenNano: 500,
    cachedInputTokenNano: 125,
    outputTokenNano: 2000
  }),
  alertThresholds: [80, 100],
  worker: { intervalMs: 2000, maxAttempts: 3 }
};

module.exports = config;