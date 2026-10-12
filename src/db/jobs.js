async function enqueue(db, type, payload, maxAttempts) {
  await db.query('INSERT INTO jobs (type, payload, max_attempts) VALUES ($1, $2, $3)', [
    type,
    JSON.stringify(payload),
    maxAttempts
  ]);
}

async function claimNext(db) {
  const { rows } = await db.query(
    `UPDATE jobs
     SET status = 'running', attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'pending' AND run_at <= now()
       ORDER BY run_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`
  );
  return rows[0] || null;
}

async function markDone(db, id) {
  await db.query("UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1", [id]);
}

async function markRetry(db, id, error, delaySeconds) {
  await db.query(
    `UPDATE jobs
     SET status = 'pending', last_error = $2, run_at = now() + make_interval(secs => $3), updated_at = now()
     WHERE id = $1`,
    [id, error, delaySeconds]
  );
}

async function markFailed(db, id, error) {
  await db.query(
    "UPDATE jobs SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1",
    [id, error]
  );
}

module.exports = { enqueue, claimNext, markDone, markRetry, markFailed };