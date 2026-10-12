async function raise(db, { kind, message, details }) {
  await db.query('INSERT INTO alerts (kind, message, details) VALUES ($1, $2, $3)', [
    kind,
    message,
    JSON.stringify(details || {})
  ]);
}

module.exports = { raise };