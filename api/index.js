/**
 * Vercel serverless entry.
 * Health responds with ZERO backend imports so cold-start/DB issues cannot 504 it.
 * /api/health/db uses Neon serverless WebSocket (not TCP pg).
 * Full Express app is lazy-loaded for all other routes.
 */

let cached = null;

async function getExpressHandler() {
  if (cached) return cached;
  const [{ createApp }, { default: serverless }] = await Promise.all([
    import('../backend/src/app.js'),
    import('serverless-http'),
  ]);
  cached = serverless(createApp(), { binary: false });
  return cached;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function pathOnly(url) {
  return String(url || '').split('?')[0];
}

async function pingDb() {
  const { normalizeDatabaseUrl } = await import('../backend/src/config/dbUrl.js');
  const { Pool, neonConfig } = await import('@neondatabase/serverless');
  if (typeof WebSocket === 'undefined') {
    const ws = (await import('ws')).default;
    neonConfig.webSocketConstructor = ws;
  }
  const connectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (!connectionString) throw new Error('DATABASE_URL missing');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 8_000 });
  try {
    const r = await pool.query('select 1::int as ok, now() as n');
    return r.rows[0];
  } finally {
    await pool.end();
  }
}

export default async function handler(req, res) {
  try {
    const path = pathOnly(req.url);

    if (path === '/api/health' || path === '/health') {
      sendJson(res, 200, {
        ok: true,
        deploy: '2026-07-29-v6-neon-ws',
        time: new Date().toISOString(),
        runtime: 'vercel',
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        hasJwtSecret: Boolean(process.env.JWT_SECRET),
      });
      return;
    }

    if (path === '/api/health/db') {
      const started = Date.now();
      try {
        const row = await pingDb();
        sendJson(res, 200, {
          ok: true,
          db: row,
          ms: Date.now() - started,
          driver: 'neon-serverless',
        });
      } catch (err) {
        sendJson(res, 503, {
          ok: false,
          error: 'database_unreachable',
          detail: String(err?.message || err).slice(0, 200),
          ms: Date.now() - started,
        });
      }
      return;
    }

    const expressHandler = await getExpressHandler();
    return expressHandler(req, res);
  } catch (err) {
    console.error('[api]', err?.message || err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        ok: false,
        message: 'API failed to start',
        detail: String(err?.message || err).slice(0, 200),
      });
    }
  }
}
