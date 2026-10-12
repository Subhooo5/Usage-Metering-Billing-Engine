async function findByApiKeyHash(db, apiKeyHash) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE api_key_hash = $1', [apiKeyHash]);
  return rows[0] || null;
}

async function lockById(db, id) {
  const { rows } = await db.query('SELECT * FROM tenants WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
}

async function exists(db, id) {
  const { rowCount } = await db.query('SELECT 1 FROM tenants WHERE id = $1', [id]);
  return rowCount === 1;
}

async function create(db, { name, apiKeyHash, planId = 'free' }) {
  const { rows } = await db.query(
    `INSERT INTO tenants (name, api_key_hash, plan_id) VALUES ($1, $2, $3)
     ON CONFLICT (api_key_hash) DO UPDATE SET name = EXCLUDED.name
     RETURNING *`,
    [name, apiKeyHash, planId]
  );
  return rows[0];
}

async function setPlan(db, id, { planId, status, stripeCustomerId }) {
  await db.query(
    `UPDATE tenants
     SET plan_id = $2, status = $3, stripe_customer_id = COALESCE($4, stripe_customer_id)
     WHERE id = $1`,
    [id, planId, status, stripeCustomerId || null]
  );
}

module.exports = { findByApiKeyHash, lockById, exists, create, setPlan };