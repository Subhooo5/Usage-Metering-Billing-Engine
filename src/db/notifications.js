async function insertOnce(db, { tenantId, periodStart, metric, threshold, message }) {
  const { rowCount } = await db.query(
    `INSERT INTO notifications (tenant_id, period_start, metric, threshold, message)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (tenant_id, period_start, metric, threshold) DO NOTHING`,
    [tenantId, periodStart, metric, threshold, message]
  );
  return rowCount === 1;
}

module.exports = { insertOnce };