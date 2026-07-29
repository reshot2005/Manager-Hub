/**
 * Security headers + HTTPS enforcement (Helmet + HSTS).
 * WAF: enable at the edge (Vercel Attack Challenge / Cloudflare) — see docs/SECURITY.md
 */
import helmet from 'helmet';

export function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
}

/** Redirect HTTP → HTTPS behind proxies (Vercel / load balancers). */
export function enforceHttps(req, res, next) {
  const enforce =
    process.env.ENFORCE_HTTPS === 'true' ||
    process.env.VERCEL === '1' ||
    process.env.NODE_ENV === 'production';
  if (!enforce) return next();

  const proto = (req.headers['x-forwarded-proto'] || req.protocol || '').toString().split(',')[0].trim();
  if (proto === 'https') return next();
  if (req.hostname === 'localhost' || req.hostname === '127.0.0.1') return next();

  const host = req.headers.host;
  return res.redirect(301, `https://${host}${req.originalUrl}`);
}
