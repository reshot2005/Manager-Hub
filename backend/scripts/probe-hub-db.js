import dotenv from 'dotenv';
import pg from 'pg';
import { normalizeDatabaseUrl } from '../src/config/dbUrl.js';

dotenv.config();

const raw = process.env.DATABASE_URL || '';
const cleaned = normalizeDatabaseUrl(raw);
console.log({
  has_url: Boolean(raw),
  len: raw.length,
  channel_binding: raw.includes('channel_binding'),
  pooler: raw.includes('pooler'),
  cleaned_channel_binding: cleaned.includes('channel_binding'),
});

const pool = new pg.Pool({
  connectionString: cleaned,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
  max: 1,
});

const t = Date.now();
try {
  const r = await pool.query('select 1 as ok, now() as n');
  console.log('OK_MS', Date.now() - t, r.rows[0]);
  const m = await pool.query('select count(*)::int as c from managers');
  console.log('managers', m.rows[0].c);
} catch (e) {
  console.error('FAIL_MS', Date.now() - t, e.code, e.message.slice(0, 240));
  process.exitCode = 1;
} finally {
  await pool.end();
}
