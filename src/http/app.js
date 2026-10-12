const express = require('express');
const { HttpError } = require('../errors');
const { log } = require('../logger');
const healthRoutes = require('./routes/health');
const generateRoutes = require('./routes/generate');
const usageRoutes = require('./routes/usage');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');

function errorHandler(error, req, res, next) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.code, message: error.message, ...error.extra });
  }

  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'The request body is not valid JSON.' });
  }

  log({ event: 'unhandled_error', message: error.message });
  res.status(500).json({ error: 'internal_error', message: 'Something went wrong.' });
}

function createApp() {
  const app = express();
  app.use(webhookRoutes);
  app.use(express.json());
  app.use(express.json());
  app.use(healthRoutes);
  app.use(generateRoutes);
  app.use(usageRoutes);
    app.use(billingRoutes);
  app.use((req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such route.' });
  });
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };