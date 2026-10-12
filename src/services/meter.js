const crypto = require('crypto');
const config = require('../config');
const { withTransaction } = require('../db/pool');
const tenantsRepo = require('../db/tenants');
const plansRepo = require('../db/plans');
const usageRepo = require('../db/usage');
const jobsRepo = require('../db/jobs');
const { totalTokens, calculateCostNano, formatUsd } = require('./pricing');
const { currentPeriod } = require('./period');
const { checkQuota, crossedThresholds } = require('./quota');

function hashTokens(tokens) {
  const payload = JSON.stringify([tokens.input, tokens.cachedInput, tokens.output, tokens.reasoning]);
  return crypto.createHash('sha256').update(payload).digest('hex');
}

async function recordUsage({ tenantId, idempotencyKey, tokens }) {
  const requestHash = hashTokens(tokens);
  const requested = { apiCalls: 1, tokens: totalTokens(tokens) };
  const now = new Date();
  const period = currentPeriod(now);

  return withTransaction(async (db) => {
    const tenant = await tenantsRepo.lockById(db, tenantId);

    const existing = await usageRepo.findByKey(db, tenantId, idempotencyKey);
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return {
          status: 409,
          headers: {},
          body: {
            error: 'idempotency_key_reused',
            message: 'This idempotency key was already used with a different request.'
          }
        };
      }
      return { status: 201, headers: { 'Idempotent-Replayed': 'true' }, body: existing.response };
    }

    const plan = await plansRepo.findById(db, tenant.plan_id);
    const used = await usageRepo.totalsForPeriod(db, tenantId, period);

    const blocked = checkQuota({ tenant, plan, used, requested, period, now });
    if (blocked) {
      return blocked;
    }

    const eventId = crypto.randomUUID();
    const costNano = calculateCostNano(requested.apiCalls, tokens);
    const after = { apiCalls: used.apiCalls + requested.apiCalls, tokens: used.tokens + requested.tokens };

    const body = {
      eventId,
      usage: { apiCalls: requested.apiCalls, tokens, totalTokens: requested.tokens },
      cost: { nano: costNano, usd: formatUsd(costNano) },
      remaining: {
        apiCalls: plan.api_call_limit - after.apiCalls,
        tokens: plan.token_limit - after.tokens
      }
    };

    await usageRepo.insert(db, {
      id: eventId,
      tenantId,
      idempotencyKey,
      requestHash,
      apiCalls: requested.apiCalls,
      tokens,
      totalTokens: requested.tokens,
      costNano,
      response: body
    });

    const crossed = crossedThresholds(used, after, plan, config.alertThresholds);
    for (const item of crossed) {
      await jobsRepo.enqueue(
        db,
        'usage_alert',
        {
          tenantId,
          metric: item.metric,
          threshold: item.threshold,
          periodStart: period.start.toISOString().slice(0, 10)
        },
        config.worker.maxAttempts
      );
    }

    return { status: 201, headers: {}, body };
  });
}

module.exports = { recordUsage };