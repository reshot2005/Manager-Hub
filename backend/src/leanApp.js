/**
 * Lean Express app for Vercel — no bootstrap / rate-limit / helmet.
 * Critical: never await a body stream on GET (express.json hangs → 504).
 */
import express from 'express';

function safeJsonParser() {
  const parser = express.json({ limit: '256kb' });
  return (req, res, next) => {
    const method = (req.method || 'GET').toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }
    // Body already provided by serverless-http / Vercel
    if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
      return next();
    }
    const ct = String(req.headers['content-type'] || '');
    if (!ct.includes('application/json') && !ct.includes('text/plain') && method === 'DELETE') {
      return next();
    }
    // Hard timeout so a stuck stream can never 504 the whole function silently
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      req.body = req.body && typeof req.body === 'object' ? req.body : {};
      next();
    }, 1500);
    parser(req, res, (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      next(err);
    });
  };
}

export function createLeanApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(safeJsonParser());

  app.use('/api/auth', async (req, res, next) => {
    const { default: authRoutes } = await import('./routes/authRoutes.js');
    return authRoutes(req, res, next);
  });

  app.use('/api', async (req, res, next) => {
    if (req.path.startsWith('/auth') || req.path.startsWith('/chat') || req.path.startsWith('/health')) {
      return next();
    }
    const { default: dataRoutes } = await import('./routes/dataRoutes.js');
    return dataRoutes(req, res, next);
  });

  app.use((req, res) => {
    res.status(404).json({
      message: 'Not found',
      path: req.path,
      url: req.url,
    });
  });

  app.use((err, _req, res, _next) => {
    console.error('[lean-api]', err?.message || err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  return app;
}
