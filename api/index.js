/**
 * Vercel serverless entry — keep critical paths free of Express.
 * Root cause of login 504: getExpressHandler()/Express import hangs on Vercel.
 * DB is fine (Neon serverless). Auth is handled here directly.
 */

import { Buffer } from 'buffer';

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

function corsHeaders(req) {
  const origin = req.headers?.origin || req.headers?.Origin || '';
  const allowed = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const headers = {
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
  if (!origin) return headers;
  if (!allowed.length || allowed.includes(origin) || allowed.includes('*')) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function applyCors(req, res) {
  const headers = corsHeaders(req);
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
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
  if (!process.env.JWT_SECRET) {
    return sendJson(res, 503, { message: 'JWT_SECRET is not configured' });
  }

  const pool = await getDbPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, password_hash, is_active,
              COALESCE(token_version, 0) AS token_version,
              locked_until, COALESCE(failed_login_attempts, 0) AS failed_login_attempts
       FROM managers WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    const manager = rows[0];
    if (!manager || !manager.is_active) {
      return sendJson(res, 401, { message: 'Invalid credentials' });
    }
    if (manager.locked_until && new Date(manager.locked_until) > new Date()) {
      return sendJson(res, 423, {
        message: 'Account locked after repeated failed attempts. Try again later.',
      });
    }

    const bcrypt = (await import('bcryptjs')).default;
    const ok = await bcrypt.compare(password, manager.password_hash);
    if (!ok) {
      const attempts = Number(manager.failed_login_attempts || 0) + 1;
      const maxFailed = Number(process.env.LOGIN_MAX_FAILED || 5);
      const lockMinutes = Number(process.env.LOGIN_LOCK_MINUTES || 15);
      const lockUntil = attempts >= maxFailed ? new Date(Date.now() + lockMinutes * 60_000) : null;
      await pool.query(
        `UPDATE managers SET failed_login_attempts = $2, locked_until = COALESCE($3, locked_until), updated_at = NOW()
         WHERE id = $1`,
        [manager.id, attempts, lockUntil]
      );
      if (lockUntil) {
        return sendJson(res, 423, {
          message: 'Account locked after repeated failed attempts. Try again later.',
        });
      }
      return sendJson(res, 401, { message: 'Invalid credentials' });
    }

    await pool.query(
      `UPDATE managers SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE id = $1`,
      [manager.id]
    );

    const jwt = (await import('jsonwebtoken')).default;
    const token = jwt.sign(
      {
        id: manager.id,
        role: manager.role,
        email: manager.email,
        tv: manager.token_version || 0,
        typ: 'access',
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );

    // Optional refresh token (best-effort — don't fail login)
    try {
      const crypto = await import('crypto');
      const rawRefresh = crypto.randomBytes(48).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(rawRefresh).digest('hex');
      const days = Number(process.env.JWT_REFRESH_DAYS || 7);
      await pool.query(
        `INSERT INTO refresh_tokens (manager_id, token_hash, expires_at)
         VALUES ($1, $2, NOW() + ($3::int * INTERVAL '1 day'))`,
        [manager.id, tokenHash, days]
      );
      const isProd = true;
      const cookie = [
        `hub_refresh=${rawRefresh}`,
        'Path=/',
        'HttpOnly',
        'SameSite=None',
        isProd ? 'Secure' : '',
        `Max-Age=${days * 86400}`,
      ]
        .filter(Boolean)
        .join('; ');
      res.setHeader('Set-Cookie', cookie);
    } catch (err) {
      console.warn('[login] refresh skip', err.message?.slice(0, 120));
    }

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
}

async function handleMe(req, res) {
  applyCors(req, res);
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return sendJson(res, 401, { message: 'Authentication required' });

  try {
    const jwt = (await import('jsonwebtoken')).default;
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const pool = await getDbPool();
    try {
      const { rows } = await pool.query(
        `SELECT id, email, name, role, is_active, COALESCE(token_version, 0) AS token_version
         FROM managers WHERE id = $1`,
        [payload.id]
      );
      const manager = rows[0];
      if (!manager?.is_active) return sendJson(res, 401, { message: 'Invalid or inactive account' });
      if (payload.tv != null && Number(payload.tv) !== Number(manager.token_version)) {
        return sendJson(res, 401, { message: 'Session revoked — please sign in again' });
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
  } catch {
    return sendJson(res, 401, { message: 'Invalid or expired token' });
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
        deploy: '2026-07-29-v7-direct-login',
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

    // Auth without Express — this is what was 504'ing before
    if (path === '/api/auth/login' && method === 'POST') {
      return handleLogin(req, res);
    }
    if (path === '/api/auth/me' && method === 'GET') {
      return handleMe(req, res);
    }

    // Everything else: Express (lazy), with timeout so it can't hang forever
    const expressPromise = getExpressHandler().then((h) => h(req, res));
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('express_load_timeout')), 12_000)
    );
    try {
      await Promise.race([expressPromise, timeoutPromise]);
    } catch (err) {
      if (String(err.message).includes('express_load_timeout')) {
        return sendJson(res, 503, {
          ok: false,
          message: 'API is warming up. Auth works; retry this page in a moment.',
          deploy: '2026-07-29-v7-direct-login',
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
