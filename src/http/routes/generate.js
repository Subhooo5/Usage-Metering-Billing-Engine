const express = require('express');
const { authenticate } = require('../middleware/auth');
const { parseWith } = require('../validate');
const { generateSchema, idempotencyKeySchema, normalizeTokens } = require('../schemas');
const { recordUsage } = require('../../services/meter');

const router = express.Router();

router.post('/generate', authenticate, async (req, res) => {
  const idempotencyKey = parseWith(idempotencyKeySchema, req.get('Idempotency-Key'), 'Idempotency-Key');
  
  const body = parseWith(generateSchema, req.body || {});
  
  const result = await recordUsage({
    tenantId: req.tenant.id,
    idempotencyKey,
    tokens: normalizeTokens(body.tokens)
  });
  
  res.status(result.status).set(result.headers).json(result.body);
});

module.exports = router;