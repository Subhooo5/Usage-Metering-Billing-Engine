const crypto = require('crypto');
const { pool } = require('../../db/pool');
const tenantsRepo = require('../../db/tenants');
const { HttpError } = require('../../errors');

async function authenticate(req, res, next) {
  const apiKey = req.get('x-api-key');
  if (!apiKey) {
    throw new HttpError(401, 'missing_api_key', 'Send your API key in the x-api-key header.');
  }

  const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const tenant = await tenantsRepo.findByApiKeyHash(pool, hash);
  
  if (!tenant) {
    throw new HttpError(401, 'invalid_api_key', 'The API key is not valid.');
  }
  
  req.tenant = tenant;
  next();
}

module.exports = { authenticate };