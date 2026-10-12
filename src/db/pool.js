const { Pool } = require('pg');
const config = require('../config');
const { log } = require('../logger');

const pool = new Pool({ connectionString: config.databaseUrl });

pool.on('error', (error) => {
  log({ event: 'pool_error', message: error.message });
});

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } 
  catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } 
  finally {
    client.release();
  }
}

module.exports = { pool, withTransaction };