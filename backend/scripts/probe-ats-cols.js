import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.ATS_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

for (const t of ['jobs', 'candidates', 'applications', 'interviews', 'pipeline_stages', 'users']) {
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t]
  );
  console.log('\n==', t, '==');
  console.log(cols.rows.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
}

// sample one job row keys
const sample = await pool.query(`SELECT * FROM jobs LIMIT 1`);
console.log('\nSample job keys:', sample.rows[0] ? Object.keys(sample.rows[0]).join(', ') : 'none');
const sampleC = await pool.query(`SELECT * FROM candidates LIMIT 1`);
console.log('Sample candidate keys:', sampleC.rows[0] ? Object.keys(sampleC.rows[0]).join(', ') : 'none');
const sampleI = await pool.query(`SELECT * FROM interviews LIMIT 1`);
console.log('Sample interview keys:', sampleI.rows[0] ? Object.keys(sampleI.rows[0]).join(', ') : 'none');

await pool.end();
