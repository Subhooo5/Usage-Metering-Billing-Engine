const express = require('express');
const { pool } = require('../../db/pool');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
  } 
  catch (error) {
    return res.status(503).json({ status: 'error', db: 'error' });
  }
  res.status(200).json({ status: 'ok', db: 'ok' });
});

module.exports = router;