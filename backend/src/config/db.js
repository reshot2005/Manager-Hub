import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

function needsSsl(url) {
  if (!url) return false;
  if (url.includes('sslmode=require') || url.includes('sslmode=verify')) return true;
  if (url.includes('neon.tech') || url.includes('supabase.co') || url.includes('render.com')) {
    return true;
  }
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
}

const pool = new Pool({
  connectionString,
  ssl: needsSsl(connectionString)
    ? {
        // Set DB_SSL_REJECT_UNAUTHORIZED=true once CA bundle is configured (Neon/AWS RDS).
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
      }
    : false,
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
  connectionTimeoutMillis: process.env.VERCEL ? 8_000 : 20_000,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

export default { query, getClient, pool };
