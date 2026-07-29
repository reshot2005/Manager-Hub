import dotenv from 'dotenv';
import { normalizeDatabaseUrl } from './dbUrl.js';

dotenv.config();

const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
const useNeonServerless =
  Boolean(process.env.VERCEL) ||
  process.env.USE_NEON_SERVERLESS === 'true' ||
  (connectionString || '').includes('neon.tech');

let queryImpl;
let getClientImpl;

if (useNeonServerless && connectionString) {
  // WebSocket Pool — works on Vercel; plain `pg` TCP often hangs (504)
  const { Pool, neonConfig } = await import('@neondatabase/serverless');
  if (typeof WebSocket === 'undefined') {
    const ws = (await import('ws')).default;
    neonConfig.webSocketConstructor = ws;
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
  });

  pool.on('error', (err) => {
    console.error('[db:neon] pool error', err.message?.slice(0, 200));
  });

  queryImpl = (text, params) => pool.query(text, params);
  getClientImpl = () => pool.connect();
  console.log('[db] using @neondatabase/serverless');
} else {
  const pg = await import('pg');
  const { Pool } = pg.default || pg;

  function needsSsl(url) {
    if (!url) return false;
    if (url.includes('sslmode=require') || url.includes('sslmode=verify')) return true;
    if (url.includes('neon.tech') || url.includes('supabase.co') || url.includes('render.com')) {
      return true;
    }
    if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
    return Boolean(process.env.NODE_ENV === 'production');
  }

  const pool = new Pool({
    connectionString,
    ssl: needsSsl(connectionString)
      ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
      : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

  pool.on('error', (err) => {
    console.error('[db:pg] pool error', err.message?.slice(0, 200));
  });

  queryImpl = (text, params) => pool.query(text, params);
  getClientImpl = () => pool.connect();
}

export async function query(text, params) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  return queryImpl(text, params);
}

export async function getClient() {
  return getClientImpl();
}

export default { query, getClient };
