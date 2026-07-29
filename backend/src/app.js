import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/authRoutes.js';
import chatRoutes from './routes/chatRoutes.js';
import dataRoutes from './routes/dataRoutes.js';
import { ensureBootstrap } from './services/bootstrap.js';
import { securityHeaders, enforceHttps } from './middleware/security.js';
import { globalApiLimiter } from './middleware/rateLimits.js';
import { logServerError, safeClientError } from './utils/safeError.js';
import { runHubBackup } from './services/backup.js';

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

  // Production: never allow * — require explicit origins
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    if (!origins.length) {
      console.warn('[cors] CORS_ORIGIN empty in production — only same-origin / no Origin allowed');
    }
    return (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / server-to-server
      if (origins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS blocked'), false);
    };
  }

  // Local: default to Vite + allow configured list
  const localDefaults = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const allow = origins.length ? origins : localDefaults;
  return (origin, cb) => {
    if (!origin || allow.includes(origin)) return cb(null, true);
    return cb(null, false);
  };
}

/**
 * Shared Express app for local server + Vercel serverless.
 */
export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Instant liveness — no DB (use this to confirm a deploy is live)
  app.get('/api/health', (req, res) => {
    res.status(200).json({
      ok: true,
      service: 'manager-hub',
      deploy: '2026-07-29-ssl-fix',
      time: new Date().toISOString(),
      runtime: process.env.VERCEL ? 'vercel' : 'node',
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasJwtSecret: Boolean(process.env.JWT_SECRET),
    });
  });

  app.get('/api/health/db', async (_req, res) => {
    const started = Date.now();
    try {
      const { query } = await import('./config/db.js');
      const r = await Promise.race([
        query('select 1::int as ok'),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('db timeout')), 5_000)
        ),
      ]);
      res.json({ ok: true, db: r.rows[0], ms: Date.now() - started });
    } catch (err) {
      logServerError('[health/db]', err);
      res.status(503).json({
        ok: false,
        error: 'database_unreachable',
        ms: Date.now() - started,
      });
    }
  });

  app.use(enforceHttps);
  app.use(securityHeaders());
  app.use(
    cors({
      origin: buildCorsOrigin(),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use('/api', globalApiLimiter);

  app.use(async (req, res, next) => {
    const p = req.path || '';
    if (!p.startsWith('/api')) return next();
    // Never block health or auth on bootstrap
    if (
      p === '/api/health' ||
      p.startsWith('/api/health') ||
      p.startsWith('/api/auth')
    ) {
      return next();
    }
    try {
      await Promise.race([
        ensureBootstrap({ light: true }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('bootstrap timeout')), 8_000)
        ),
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

  app.use('/api/auth', authRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api', dataRoutes);

  app.use((err, _req, res, _next) => {
    logServerError('[unhandled]', err);
    if (err?.message === 'CORS blocked') {
      return res.status(403).json({ message: 'Origin not allowed' });
    }
    res.status(500).json({ message: 'Internal server error' });
  });

  return app;
}
