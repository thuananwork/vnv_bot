const db = require('../src/config/db');

(async () => {
  const clusters = await db.all('SELECT * FROM clusters');
  console.log('CLUSTERS:');
  console.table(clusters);
  const users = await db.all('SELECT id, username, role, managed_cluster_id, managed_region_id FROM users');
  console.log('USERS:');
  console.table(users);
  process.exit(0);
})();
