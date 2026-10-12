const { pool } = require('../db/pool');
const plansRepo = require('../db/plans');
const usageRepo = require('../db/usage');
const { currentPeriod } = require('./period');
const { formatUsd } = require('./pricing');

async function getUsage(tenant) {
  const period = currentPeriod();
  const plan = await plansRepo.findById(pool, tenant.plan_id);
  const used = await usageRepo.totalsForPeriod(pool, tenant.id, period);

  return {
    tenant: { id: tenant.id, name: tenant.name },
    plan: { id: plan.id, name: plan.name },
    status: tenant.status,
    period: { start: period.start.toISOString(), end: period.end.toISOString() },
    apiCalls: {
      used: used.apiCalls,
      limit: plan.api_call_limit,
      remaining: plan.api_call_limit - used.apiCalls
    },
    aiTokens: {
      used: used.tokens,
      limit: plan.token_limit,
      remaining: plan.token_limit - used.tokens
    },
    cost: { nano: used.costNano, usd: formatUsd(used.costNano) }
  };
}

module.exports = { getUsage };