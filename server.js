const config = require('./src/config');
const { migrate } = require('./src/db/migrate');
const { createApp } = require('./src/http/app');
const { startWorker } = require('./src/jobs/worker');
const { log } = require('./src/logger');

async function start() {
  await migrate();
  startWorker(config.worker.intervalMs);
  const app = createApp();
  app.listen(config.port, () => {
    log({ event: 'listening', port: config.port });
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});