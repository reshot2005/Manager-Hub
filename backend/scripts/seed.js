import dotenv from 'dotenv';
import { ensureBootstrap } from '../src/services/bootstrap.js';

dotenv.config();

async function seed() {
  if (!process.env.SEED_MANAGER_PASSWORD) {
    console.error('Set SEED_MANAGER_PASSWORD in backend/.env before seeding (no default password).');
    process.exit(1);
  }
  const result = await ensureBootstrap();
  const email = process.env.SEED_MANAGER_EMAIL || 'manager@hub.local';
  console.log('Seeded / refreshed manager (idempotent):');
  console.log(`  email: ${email}`);
  console.log('  password: [set via SEED_MANAGER_PASSWORD — not logged]');
  console.log('  role: ADMIN');
  console.log('  bootstrap:', result.ok ? 'ok' : result);
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
