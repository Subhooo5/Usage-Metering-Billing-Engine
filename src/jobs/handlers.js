const { pool } = require('../db/pool');
const notificationsRepo = require('../db/notifications');
const { log } = require('../logger');

async function usageAlert(payload) {
  const created = await notificationsRepo.insertOnce(pool, {
    tenantId: payload.tenantId,
    periodStart: payload.periodStart,
    metric: payload.metric,
    threshold: payload.threshold,
    message: `You have used ${payload.threshold}% of your monthly ${payload.metric} quota.`
  });
  log({
    event: 'usage_alert_sent',
    tenantId: payload.tenantId,
    metric: payload.metric,
    threshold: payload.threshold,
    created
  });
}

module.exports = { usage_alert: usageAlert };