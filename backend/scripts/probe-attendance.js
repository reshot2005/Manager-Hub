import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.ATTENDANCE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const tables = await pool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`
);
console.log('TABLES:', tables.rows.map((r) => r.table_name).join(', '));

for (const t of tables.rows) {
  const cols = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [t.table_name]
  );
  console.log('\n==', t.table_name, '==');
  console.log(cols.rows.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
}

await pool.end();
