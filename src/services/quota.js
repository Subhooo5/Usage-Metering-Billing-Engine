function checkQuota({ tenant, plan, used, requested, period, now }) {
  if (tenant.status !== 'active') {
    return {
      status: 402,
      headers: {},
      body: {
        error: 'payment_required',
        message: 'Your subscription payment is overdue. Update your payment method to continue.'
      }
    };
  }

  const exceededCalls = used.apiCalls + requested.apiCalls > plan.api_call_limit;
  const exceededTokens = used.tokens + requested.tokens > plan.token_limit;
  if (!exceededCalls && !exceededTokens) {
    return null;
  }

  const metric = exceededCalls ? 'api_calls' : 'ai_tokens';
  const detail = {
    metric,
    limit: exceededCalls ? plan.api_call_limit : plan.token_limit,
    used: exceededCalls ? used.apiCalls : used.tokens,
    requested: exceededCalls ? requested.apiCalls : requested.tokens
  };

  if (plan.id === 'free') {
    return {
      status: 402,
      headers: {},
      body: {
        error: 'upgrade_required',
        message: `Free plan monthly ${metric} limit reached. Upgrade to Pro to continue.`,
        ...detail
      }
    };
  }

  const retryAfter = Math.max(Math.ceil((period.end.getTime() - now.getTime()) / 1000), 1);
  return {
    status: 429,
    headers: { 'Retry-After': String(retryAfter) },
    body: {
      error: 'quota_exceeded',
      message: `Monthly ${metric} quota reached. It resets on ${period.end.toISOString()}.`,
      ...detail
    }
  };
}

function crossedThresholds(before, after, plan, thresholds) {
  const metrics = [
    { metric: 'api_calls', before: before.apiCalls, after: after.apiCalls, limit: plan.api_call_limit },
    { metric: 'ai_tokens', before: before.tokens, after: after.tokens, limit: plan.token_limit }
  ];
  
  const crossed = [];
  for (const item of metrics) {
    for (const threshold of thresholds) {
      const mark = (item.limit * threshold) / 100;
      if (item.before < mark && item.after >= mark) {
        crossed.push({ metric: item.metric, threshold });
      }
    }
  }
  return crossed;
}

module.exports = { checkQuota, crossedThresholds };