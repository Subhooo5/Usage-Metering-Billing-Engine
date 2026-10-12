async function markProcessed(db, event) {
  const { rowCount } = await db.query(
    'INSERT INTO stripe_events (event_id, type) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING',
    [event.id, event.type]
  );
  return rowCount === 1;
}

module.exports = { markProcessed };