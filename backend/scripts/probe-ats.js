import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const url = process.env.ATS_DATABASE_URL;
if (!url) {
  console.error('ATS_DATABASE_URL missing');
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
});

try {
  const tables = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public'
    ORDER BY table_name
  `);
  console.log('ATS connected OK');
  console.log('Tables:', tables.rows.map((r) => r.table_name).join(', ') || '(none)');

  for (const name of ['jobs', 'candidates', 'applications', 'interviews', 'pipeline_stages']) {
    try {
      const c = await pool.query(`SELECT COUNT(*)::int AS n FROM ${name}`);
      console.log(`  ${name}: ${c.rows[0].n}`);
    } catch (err) {
      console.log(`  ${name}: (missing or error) ${err.message}`);
    }
  }
  process.exit(0);
} catch (err) {
  console.error('ATS connection FAILED:', err.message);
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
