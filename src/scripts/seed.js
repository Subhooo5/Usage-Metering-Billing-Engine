const crypto = require('crypto');
const { pool } = require('../db/pool');
const tenantsRepo = require('../db/tenants');

const demoTenants = [
  { name: 'Alpha Corp', apiKey: 'demo-key-alpha' },
  { name: 'Beta Corp', apiKey: 'demo-key-beta' }
];

async function seed() {
  for (const item of demoTenants) {
    const apiKeyHash = crypto.createHash('sha256').update(item.apiKey).digest('hex');
    const tenant = await tenantsRepo.create(pool, { name: item.name, apiKeyHash });
    console.log(`${tenant.name} id=${tenant.id} api_key=${item.apiKey} plan=${tenant.plan_id}`);
  }
  await pool.end();
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});