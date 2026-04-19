const authStore = require('../services/infra/auth-store');
const { initDb } = require('../services/infra/db');

initDb();

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin1234';

try {
  const existing = authStore.findUserByUsername(username);

  if (existing) {
    authStore.setPassword(existing.id, password);
    console.log(`✅ Password actualizada para ${username}`);
  } else {
    authStore.createUser({
      username,
      password,
      role: 'admin'
    });
    console.log(`✅ Usuario admin creado: ${username}`);
  }
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}