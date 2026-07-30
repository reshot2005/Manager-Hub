import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { query } from '../src/config/db.js';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

async function initDb() {
  const schema = readFileSync(join(__dirname, '../src/db/schema.sql'), 'utf8');
  await query(schema);
  try {
    const migrate = readFileSync(join(__dirname, '../src/db/migrate_acl.sql'), 'utf8');
    await query(migrate);
  } catch (err) {
    console.warn('ACL migrate note:', err.message);
  }
  try {
    const att = readFileSync(join(__dirname, '../src/db/migrate_attendance.sql'), 'utf8');
    await query(att);
  } catch (err) {
    console.warn('Attendance migrate note:', err.message);
  }
  try {
    const shifts = readFileSync(join(__dirname, '../src/db/migrate_shifts.sql'), 'utf8');
    await query(shifts);
  } catch (err) {
    console.warn('Shifts migrate note:', err.message);
  }
  try {
    const leave = readFileSync(join(__dirname, '../src/db/migrate_leave_risk_alerts.sql'), 'utf8');
    await query(leave);
  } catch (err) {
    console.warn('Leave/risk/alerts migrate note:', err.message);
  }
  console.log('Schema applied successfully (incl. ACL + attendance + shifts + leave/risk/alerts).');
  process.exit(0);
}

initDb().catch((err) => {
  console.error('Failed to init DB:', err.message || err);
  if (err.code === 'ECONNREFUSED' || String(err).includes('ECONNREFUSED')) {
    console.error(`
Hub Postgres is not reachable at DATABASE_URL (expected localhost:5433).

Fix:
  1. Start Docker Desktop and wait until it is running
  2. From manager-hub root:  docker compose up -d
  3. Re-run:  npm run db:init
  4. Then:    npm run sync
`);
  }
  process.exit(1);
});
