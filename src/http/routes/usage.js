const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getUsage } = require('../../services/usage');

const router = express.Router();

router.get('/usage', authenticate, async (req, res) => {
  res.status(200).json(await getUsage(req.tenant));
});

module.exports = router;