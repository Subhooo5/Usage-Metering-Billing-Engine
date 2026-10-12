async function findById(db, id) {
  const { rows } = await db.query(
    'SELECT id, name, api_call_limit, token_limit FROM plans WHERE id = $1',
    [id]
  );

  const row = rows[0];
  
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    api_call_limit: Number(row.api_call_limit),
    token_limit: Number(row.token_limit)
  };
}

module.exports = { findById };