/**
 * Vercel serverless entry.
 * Login/me/health bypass Express (Express cold-start hangs on Vercel → 504).
 * DB uses @neondatabase/serverless (TCP pg hangs on Vercel).
 */

import { Buffer } from 'node:buffer';

let cachedExpress = null;

function sendJson(res, status, body) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function pathOnly(url) {
  return String(url || '').split('?')[0];
}

function applyCors(req, res) {
  const origin = req.headers?.origin || '';
  const allowed = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  if (origin && (!allowed.length || allowed.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
}

async function readJsonBody(req) {
  try {
    if (req.body != null) {
      if (Buffer.isBuffer(req.body)) {
        const raw = req.body.toString('utf8');
        return raw ? JSON.parse(raw) : {};
      }
      if (typeof req.body === 'object') return req.body;
      if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    }
  } catch {
    /* stream fallback */
  }

  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const t = setTimeout(() => finish({}), 2500);
    req.on?.('data', (c) => chunks.push(c));
    req.on?.('end', () => {
      clearTimeout(t);
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        finish(raw ? JSON.parse(raw) : {});
      } catch {
        finish({});
      }
    });
    req.on?.('error', () => {
      clearTimeout(t);
      finish({});
    });
    // If stream already ended / no events
    if (req.readableEnded) {
      clearTimeout(t);
      finish({});
    }
  });
}

async function getDbPool() {
  const { normalizeDatabaseUrl } = await import('../backend/src/config/dbUrl.js');
  const { Pool, neonConfig } = await import('@neondatabase/serverless');
  if (typeof WebSocket === 'undefined') {
    const ws = (await import('ws')).default;
    neonConfig.webSocketConstructor = ws;
  }
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error('DATABASE_URL missing');
  return new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000 });
}

async function handleLogin(req, res) {
  applyCors(req, res);
  try {
    const body = await readJsonBody(req);
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    const password = String(body.password || '');
    if (!email || !password) {
      return sendJson(res, 400, { message: 'Email and password are required' });
    }
    if (!process.env.DATABASE_URL) {
      return sendJson(res, 503, { message: 'DATABASE_URL is not configured' });
    }
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
      return sendJson(res, 503, { message: 'JWT_SECRET is missing or too short' });
    }

    const pool = await getDbPool();
    try {
      // Only columns from original schema — avoid missing migrate_security columns
      const { rows } = await pool.query(
        `SELECT id, email, name, role, password_hash, is_active
         FROM managers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [email]
      );
      const manager = rows[0];
      if (!manager || manager.is_active === false) {
        return sendJson(res, 401, { message: 'Invalid credentials' });
      }

      const bcryptMod = await import('bcryptjs');
      const bcrypt = bcryptMod.default || bcryptMod;
      const ok = await bcrypt.compare(password, manager.password_hash);
      if (!ok) {
        return sendJson(res, 401, { message: 'Invalid credentials' });
      }

      const jwtMod = await import('jsonwebtoken');
      const jwt = jwtMod.default || jwtMod;
      const token = jwt.sign(
        {
          id: manager.id,
          role: manager.role,
          email: manager.email,
          tv: 0,
          typ: 'access',
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
      );

      return sendJson(res, 200, {
        token,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        user: {
          id: manager.id,
          email: manager.email,
          name: manager.name,
          role: manager.role,
        },
      });
    } finally {
      try {
        await pool.end();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error('[login]', err);
    return sendJson(res, 500, {
      message: 'Login failed',
      detail: String(err?.message || err).slice(0, 240),
    });
  }
}

async function handleMe(req, res) {
  applyCors(req, res);
  try {
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return sendJson(res, 401, { message: 'Authentication required' });

    const jwtMod = await import('jsonwebtoken');
    const jwt = jwtMod.default || jwtMod;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const pool = await getDbPool();
    try {
      const { rows } = await pool.query(
        `SELECT id, email, name, role, is_active FROM managers WHERE id = $1`,
        [payload.id]
      );
      const manager = rows[0];
      if (!manager || manager.is_active === false) {
        return sendJson(res, 401, { message: 'Invalid or inactive account' });
      }
      return sendJson(res, 200, {
        user: {
          id: manager.id,
          email: manager.email,
          name: manager.name,
          role: manager.role,
        },
      });
    } finally {
      await pool.end();
    }
  } catch (err) {
    return sendJson(res, 401, {
      message: 'Invalid or expired token',
      detail: String(err?.message || '').slice(0, 120),
    });
  }
}

async function getExpressHandler() {
  if (cachedExpress) return cachedExpress;
  const [{ createApp }, { default: serverless }] = await Promise.all([
    import('../backend/src/app.js'),
    import('serverless-http'),
  ]);
  cachedExpress = serverless(createApp(), { binary: false });
  return cachedExpress;
}

export default async function handler(req, res) {
  try {
    applyCors(req, res);
    const path = pathOnly(req.url);
    const method = (req.method || 'GET').toUpperCase();

    if (method === 'OPTIONS') {
      res.statusCode = 204;
      res.end('');
      return;
    }

    if (path === '/api/health' || path === '/health') {
      return sendJson(res, 200, {
        ok: true,
        deploy: '2026-07-29-v8-login-safe',
        time: new Date().toISOString(),
        runtime: 'vercel',
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        hasJwtSecret: Boolean(process.env.JWT_SECRET),
      });
    }

    if (path === '/api/health/db') {
      const started = Date.now();
      const pool = await getDbPool();
      try {
        const r = await pool.query('select 1::int as ok, now() as n');
        return sendJson(res, 200, {
          ok: true,
          db: r.rows[0],
          ms: Date.now() - started,
          driver: 'neon-serverless',
        });
      } finally {
        await pool.end();
      }
    }

    if (path === '/api/auth/login' && method === 'POST') {
      return handleLogin(req, res);
    }
    if (path === '/api/auth/me' && method === 'GET') {
      return handleMe(req, res);
    }

    try {
      const expressHandler = await Promise.race([
        getExpressHandler(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('express_load_timeout')), 12_000)
        ),
      ]);
      return expressHandler(req, res);
    } catch (err) {
      if (String(err.message).includes('express_load_timeout')) {
        return sendJson(res, 503, {
          ok: false,
          message: 'API is warming up. Login works; retry this page shortly.',
          deploy: '2026-07-29-v8-login-safe',
        });
      }
      throw err;
    }
  } catch (err) {
    console.error('[api]', err?.message || err);
    sendJson(res, 500, {
      ok: false,
      message: 'API failed',
      detail: String(err?.message || err).slice(0, 200),
    });
  }
}
