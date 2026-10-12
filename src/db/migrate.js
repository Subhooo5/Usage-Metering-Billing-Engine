const fs = require('fs');
const path = require('path');
const { pool } = require('./pool');
const { log } = require('../logger');

const directory = path.join(__dirname, '..', '..', 'migrations');

async function migrate() {
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())'
  );

  const result = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(result.rows.map((row) => row.name));
  const files = fs.readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(fs.readFileSync(path.join(directory, file), 'utf-8'));
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log({ event: 'migration_applied', file });
    }

    catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
     
    finally {
      client.release();
    }
  }
}

if (require.main === module) {
  migrate()
    .then(() => pool.end())
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { migrate };