async function findByKey(db, tenantId, idempotencyKey) {
  const { rows } = await db.query(
    'SELECT request_hash, response FROM usage_events WHERE tenant_id = $1 AND idempotency_key = $2',
    [tenantId, idempotencyKey]
  );
  return rows[0] || null;
}

async function totalsForPeriod(db, tenantId, period) {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(api_calls), 0)::bigint AS api_calls,
            COALESCE(SUM(total_tokens), 0)::bigint AS tokens,
            COALESCE(SUM(cost_nano), 0)::bigint AS cost_nano
     FROM usage_events
     WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3`,
    [tenantId, period.start, period.end]
  );
  return {
    apiCalls: Number(rows[0].api_calls),
    tokens: Number(rows[0].tokens),
    costNano: Number(rows[0].cost_nano)
  };
}

async function insert(db, event) {
  await db.query(
    `INSERT INTO usage_events
       (id, tenant_id, idempotency_key, request_hash, api_calls,
        input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
        total_tokens, cost_nano, response)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      event.id,
      event.tenantId,
      event.idempotencyKey,
      event.requestHash,
      event.apiCalls,
      event.tokens.input,
      event.tokens.cachedInput,
      event.tokens.output,
      event.tokens.reasoning,
      event.totalTokens,
      event.costNano,
      JSON.stringify(event.response)
    ]
  );
}

module.exports = { findByKey, totalsForPeriod, insert };