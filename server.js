const config = require('./src/config');
const { migrate } = require('./src/db/migrate');
const { createApp } = require('./src/http/app');
const { log } = require('./src/logger');

async function start() {
  await migrate();
  
  const app = createApp();
  app.listen(config.port, () => {
    log({ event: 'listening', port: config.port });
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});