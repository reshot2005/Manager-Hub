import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { ensureBootstrap } from './services/bootstrap.js';
import { securityHeaders, enforceHttps } from './middleware/security.js';
import { globalApiLimiter } from './middleware/rateLimits.js';
import { logServerError, safeClientError } from './utils/safeError.js';

async function assertCronAuthorized(req, res) {
  const secret = process.env.CRON_SECRET || '';
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const headerSecret = req.headers['x-cron-secret'];
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const secretOk = Boolean(secret) && (token === secret || headerSecret === secret);

  if (process.env.VERCEL) {
    if (!secret && !isVercelCron) {
      res.status(503).json({ message: 'CRON_SECRET not configured' });
      return false;
    }
    if (isVercelCron || secretOk) return true;
    res.status(401).json({ message: 'Unauthorized cron' });
    return false;
  }

  if (!secret) {
    if (process.env.ALLOW_INSECURE_CRON === 'true') return true;
    res.status(401).json({ message: 'Unauthorized cron — set CRON_SECRET' });
    return false;
  }

  if (!secretOk) {
    res.status(401).json({ message: 'Unauthorized cron' });
    return false;
  }
  return true;
}

async function handleCronSync(req, res) {
  try {
    if (!(await assertCronAuthorized(req, res))) return;
    await ensureBootstrap({ light: false });
    const { runFullSync } = await import('./sync/index.js');
    const source = req.body?.source || req.query?.source;
    const allowedSources = ['sprintboard', 'ats', 'attendance'];
    const defaultSources = process.env.VERCEL
      ? [pickRotatingSource()]
      : ['sprintboard', 'ats', 'attendance'];
    const sources = allowedSources.includes(source) ? [source] : defaultSources;
    const result = await runFullSync({ sources });
    res.json({ bootstrapped: true, ...result });
  } catch (err) {
    logServerError('[sync/cron]', err);
    res.status(500).json({ message: safeClientError(err, 'Cron sync failed') });
  }
}

async function handleCronBackup(req, res) {
  try {
    if (!(await assertCronAuthorized(req, res))) return;
    const { runHubBackup } = await import('./services/backup.js');
    const result = await runHubBackup({ trigger: 'cron' });
    res.json(result);
  } catch (err) {
    logServerError('[backup/cron]', err);
    res.status(500).json({ message: safeClientError(err, 'Backup failed') });
  }
}

function pickRotatingSource() {
  const sources = ['attendance', 'sprintboard', 'ats'];
  const minutes = Number(process.env.SYNC_ROTATE_MINUTES || 5);
  const slot = Math.floor(Date.now() / (minutes * 60 * 1000)) % sources.length;
  return sources[slot];
}

function buildCorsOrigin() {
  const raw = process.env.CORS_ORIGIN || '';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((o) => o !== '*');

  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    return (origin, cb) => {
      if (!origin) return cb(null, true);
      if (origins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'), false);
    };
  }

  const localDefaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const allow = origins.length ? origins : localDefaults;
  return (origin, cb) => {
    if (!origin || allow.includes(origin)) return cb(null, true);
    return cb(null, false);
  };
}

/**
 * Shared Express app. Routes are required lazily to avoid Vercel cold-start hangs.
 */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  app.use(enforceHttps);
  app.use(securityHeaders());
  app.use(
    cors({
      origin: buildCorsOrigin(),
      credentials: true,
    })
  );
  // Never parse JSON on GET — on serverless, awaiting an empty body stream hangs forever (504).
  {
    const parser = express.json({ limit: '256kb' });
    app.use((req, res, next) => {
      const method = (req.method || 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
      if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        return next();
      }
      return parser(req, res, next);
    });
  }
  app.use(cookieParser());
  app.use('/api', globalApiLimiter);

  app.use(async (req, res, next) => {
    const p = req.path || '';
    if (!p.startsWith('/api')) return next();
    if (p.startsWith('/api/health') || p.startsWith('/api/auth') || p.startsWith('/api/sync/cron') || p.startsWith('/api/backup/cron')) {
      return next();
    }
    try {
      await Promise.race([
        ensureBootstrap({ light: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('bootstrap timeout')), 8_000)),
      ]);
    } catch (err) {
      console.warn('[bootstrap middleware]', err.message?.slice(0, 120));
    }
    next();
  });

  app.post('/api/sync/cron', handleCronSync);
  app.get('/api/sync/cron', handleCronSync);
  app.post('/api/backup/cron', handleCronBackup);
  app.get('/api/backup/cron', handleCronBackup);

  // Import routers (sync/backup stay lazy above to keep cold start smaller)
  // Auth is also handled in api/index.js on Vercel to avoid Express hang on login.
  app.use('/api/auth', async (req, res, next) => {
    const { default: authRoutes } = await import('./routes/authRoutes.js');
    return authRoutes(req, res, next);
  });
  app.use('/api/chat', async (req, res, next) => {
    const { default: chatRoutes } = await import('./routes/chatRoutes.js');
    return chatRoutes(req, res, next);
  });
  app.use('/api', async (req, res, next) => {
    // Avoid double-handling auth/chat/cron paths
    if (
      req.path.startsWith('/auth') ||
      req.path.startsWith('/chat') ||
      req.path.startsWith('/sync/cron') ||
      req.path.startsWith('/backup/cron') ||
      req.path.startsWith('/health')
    ) {
      return next();
    }
    const { default: dataRoutes } = await import('./routes/dataRoutes.js');
    return dataRoutes(req, res, next);
  });

  app.use((err, _req, res, _next) => {
    logServerError('[unhandled]', err);
    if (err?.message === 'CORS blocked') {
      return res.status(403).json({ message: 'Origin not allowed' });
    }
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}
