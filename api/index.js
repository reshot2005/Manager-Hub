/**
 * Vercel serverless entry.
 * Auth + Chat bypass Express (Express cold-start / dispatch hangs on Vercel → 504).
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
  return String(url || '').split('?')[0].replace(/\/+$/, '') || '/';
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

async function resolveManager(req) {
  const auth = req.headers?.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    const err = new Error('Authentication required');
    err.status = 401;
    throw err;
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    const err = new Error('JWT_SECRET is missing or too short');
    err.status = 503;
    throw err;
  }

  const jwtMod = await import('jsonwebtoken');
  const jwt = jwtMod.default || jwtMod;
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    const err = new Error('Invalid or expired token — please sign in again');
    err.status = 401;
    throw err;
  }

  const pool = await getDbPool();
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, is_active FROM managers WHERE id = $1`,
      [payload.id]
    );
    const manager = rows[0];
    if (!manager || manager.is_active === false) {
      const err = new Error('Invalid or inactive account');
      err.status = 401;
      throw err;
    }
    return {
      id: manager.id,
      email: manager.email,
      name: manager.name,
      role: manager.role,
    };
  } finally {
    try {
      await pool.end();
    } catch {
      /* ignore */
    }
  }
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
    const manager = await resolveManager(req);
    return sendJson(res, 200, { user: manager });
  } catch (err) {
    return sendJson(res, err.status || 401, {
      message: err.message || 'Invalid or expired token',
    });
  }
}

async function handleChatPost(req, res) {
  applyCors(req, res);
  try {
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key') {
      return sendJson(res, 503, {
        message:
          'AI is not configured yet. Add GEMINI_API_KEY in Vercel env, then redeploy.',
      });
    }
    if (!process.env.DATABASE_URL) {
      return sendJson(res, 503, { message: 'DATABASE_URL is not configured' });
    }

    const manager = await resolveManager(req);
    const body = await readJsonBody(req);
    const message = String(body.message || '').trim();
    if (!message) {
      return sendJson(res, 400, { message: 'message is required' });
    }
    if (message.length > 4000) {
      return sendJson(res, 400, { message: 'message is too long' });
    }

    const { chatWithGemini } = await import('../backend/src/services/chat.js');
    const result = await chatWithGemini(manager, message);
    return sendJson(res, 200, {
      reply: result.reply,
      toolsUsed: result.toolsUsed || [],
    });
  } catch (err) {
    console.error('[chat]', err?.message || err);
    const status = err.status || (String(err.message || '').includes('GEMINI') ? 503 : 500);
    // Always return a friendly, speakable message — never a bare gateway failure to the UI if we can help it
    return sendJson(res, status >= 500 ? 200 : status, {
      reply:
        status >= 500
          ? `I hit a temporary snag pulling that from the hub (${String(err.message || 'error').slice(0, 120)}). Please ask once more — I stay ready to check attendance, tasks, EODs, and interviews.`
          : undefined,
      message:
        status < 500
          ? err.message || 'Chat failed'
          : 'Chat recovered with a fallback reply',
      toolsUsed: [],
    });
  }
}

async function handleChatHistory(req, res, method) {
  applyCors(req, res);
  try {
    const manager = await resolveManager(req);
    const chat = await import('../backend/src/services/chat.js');
    if (method === 'DELETE') {
      await chat.clearChatHistory(manager.id);
      return sendJson(res, 200, { ok: true });
    }
    const history = await chat.getChatHistory(manager.id);
    return sendJson(res, 200, { history });
  } catch (err) {
    console.error('[chat/history]', err?.message || err);
    return sendJson(res, err.status || 500, {
      message: err.message || 'Failed to load history',
    });
  }
}

async function getExpressHandler() {
  if (cachedExpress) return cachedExpress;
  const [{ createLeanApp }, { default: serverless }] = await Promise.all([
    import('../backend/src/leanApp.js'),
    import('serverless-http'),
  ]);
  cachedExpress = serverless(createLeanApp(), { binary: false });
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
        deploy: '2026-07-29-v12-direct-data',
        time: new Date().toISOString(),
        runtime: 'vercel',
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        hasJwtSecret: Boolean(process.env.JWT_SECRET),
        hasGemini: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'your_gemini_api_key'),
        geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
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

    // Chat must never go through Express on Vercel (same hang that broke login)
    if (path === '/api/chat' && method === 'POST') {
      return handleChatPost(req, res);
    }
    if (path === '/api/chat/history' && (method === 'GET' || method === 'DELETE')) {
      return handleChatHistory(req, res, method);
    }

    // Data pages (employees/dashboard/…) — Express hangs on Vercel; serve Neon-direct
    if (
      path.startsWith('/api/employees') ||
      path.startsWith('/api/dashboard') ||
      path.startsWith('/api/tasks') ||
      path.startsWith('/api/eod-reports') ||
      path.startsWith('/api/candidates') ||
      path.startsWith('/api/interviews') ||
      path.startsWith('/api/attendance') ||
      path.startsWith('/api/sync/')
    ) {
      try {
        if (method === 'PATCH' || method === 'POST' || method === 'PUT') {
          req.body = await readJsonBody(req);
        }
        const manager = await resolveManager(req);
        const { handleDirectDataApi } = await import('../backend/src/directDataApi.js');
        const result = await handleDirectDataApi(req, manager);
        if (result.handled) {
          return sendJson(res, result.status || 200, result.body);
        }
      } catch (err) {
        console.error('[data]', err?.message || err);
        return sendJson(res, err.status || 500, {
          message: err.message || 'Failed to load data',
        });
      }
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
          message: 'API is warming up. Retry this page shortly.',
          deploy: '2026-07-29-v12-direct-data',
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
