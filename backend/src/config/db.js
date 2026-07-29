import pg from 'pg';
import dotenv from 'dotenv';
import { normalizeDatabaseUrl } from './dbUrl.js';

dotenv.config();

const { Pool } = pg;

const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);

function needsSsl(url) {
  if (!url) return false;
  if (url.includes('sslmode=require') || url.includes('sslmode=verify')) return true;
  if (url.includes('neon.tech') || url.includes('supabase.co') || url.includes('render.com')) {
    return true;
  }
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
}

const isServerless = Boolean(process.env.VERCEL);

const pool = new Pool({
  connectionString,
  ssl: needsSsl(connectionString)
    ? {
        // Neon works with rejectUnauthorized:false in serverless; enable strict via env when CA is set.
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
      }
    : false,
  max: isServerless ? 1 : 10,
  idleTimeoutMillis: isServerless ? 5_000 : 30_000,
  connectionTimeoutMillis: isServerless ? 5_000 : 15_000,
  allowExitOnIdle: isServerless,
});

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err.message?.slice(0, 200));
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function getClient() {
  return pool.connect();
}

export default { query, getClient, pool };
