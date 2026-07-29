/**
 * Vercel serverless entry.
 * Health responds with ZERO backend imports so cold-start/DB issues cannot 504 it.
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

function isHealthPath(url) {
  const path = String(url || '').split('?')[0];
  return path === '/api/health' || path === '/health';
}

export default async function handler(req, res) {
  try {
    if (isHealthPath(req.url)) {
      sendJson(res, 200, {
        ok: true,
        deploy: '2026-07-29-v5-lazy',
        time: new Date().toISOString(),
        runtime: 'vercel',
        hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
        hasJwtSecret: Boolean(process.env.JWT_SECRET),
      });
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
