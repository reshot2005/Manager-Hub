import rateLimit from 'express-rate-limit';

/** Global API abuse protection — all routes. */
export const globalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_API_PER_MIN || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests. Please slow down.' },
});

/** Stricter limit on login / refresh. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH_PER_15M || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many login attempts. Try again later.' },
});

/** Chat-specific (in addition to global). */
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_CHAT_PER_MIN || 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many chat requests. Please wait a moment.' },
});
