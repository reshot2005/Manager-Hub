import { Router } from 'express';
import { query } from '../config/db.js';
import {
  comparePassword,
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  cookieOptions,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../utils/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimits.js';
import { asEmail, asString } from '../utils/validate.js';
import { logServerError, safeClientError } from '../utils/safeError.js';

const router = Router();

const MAX_FAILED = Number(process.env.LOGIN_MAX_FAILED || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);

function clientMeta(req) {
  return {
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    ip: req.ip || req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || null,
  };
}

function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(15 * 60 * 1000));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(7 * 24 * 60 * 60 * 1000));
}

function clearAuthCookies(res) {
  const base = cookieOptions(0);
  res.clearCookie(ACCESS_COOKIE, { ...base, maxAge: 0 });
  res.clearCookie(REFRESH_COOKIE, { ...base, maxAge: 0 });
}

router.post('/login', authLimiter, async (req, res) => {
  try {
    const email = asEmail(req.body?.email);
    const password = asString(req.body?.password, { max: 200, min: 1 });
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const { rows } = await query(
      `SELECT * FROM managers WHERE LOWER(email) = LOWER($1)`,
      [email]
    );
    const manager = rows[0];

    if (!manager || !manager.is_active) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (manager.locked_until && new Date(manager.locked_until) > new Date()) {
      return res.status(423).json({
        message: 'Account locked after repeated failed attempts. Try again later.',
      });
    }

    const ok = await comparePassword(password, manager.password_hash);
    if (!ok) {
      const attempts = (manager.failed_login_attempts || 0) + 1;
      const lockUntil =
        attempts >= MAX_FAILED
          ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000)
          : null;
      await query(
        `UPDATE managers
         SET failed_login_attempts = $2,
             locked_until = COALESCE($3, locked_until),
             updated_at = NOW()
         WHERE id = $1`,
        [manager.id, attempts, lockUntil]
      );
      if (lockUntil) {
        return res.status(423).json({
          message: 'Account locked after repeated failed attempts. Try again later.',
        });
      }
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await query(
      `UPDATE managers
       SET failed_login_attempts = 0, locked_until = NULL, updated_at = NOW()
       WHERE id = $1`,
      [manager.id]
    );

    const accessToken = signAccessToken(manager);
    const { refreshToken } = await issueRefreshToken(manager.id, clientMeta(req));
    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      token: accessToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      user: {
        id: manager.id,
        email: manager.email,
        name: manager.name,
        role: manager.role,
      },
    });
  } catch (err) {
    logServerError('[auth/login]', err);
    res.status(500).json({ message: safeClientError(err, 'Login failed') });
  }
});

router.post('/refresh', authLimiter, async (req, res) => {
  try {
    const raw =
      req.cookies?.[REFRESH_COOKIE] ||
      asString(req.body?.refreshToken, { max: 500, min: 20 });
    if (!raw) {
      return res.status(401).json({ message: 'Refresh token required' });
    }

    const rotated = await rotateRefreshToken(raw, clientMeta(req));
    if (!rotated) {
      clearAuthCookies(res);
      return res.status(401).json({ message: 'Invalid or expired refresh token' });
    }

    const accessToken = signAccessToken(rotated.manager);
    setAuthCookies(res, accessToken, rotated.refreshToken);

    res.json({
      token: accessToken,
      expiresIn: process.env.JWT_EXPIRES_IN || '15m',
      user: {
        id: rotated.manager.id,
        email: rotated.manager.email,
        name: rotated.manager.name,
        role: rotated.manager.role,
      },
    });
  } catch (err) {
    logServerError('[auth/refresh]', err);
    res.status(500).json({ message: safeClientError(err, 'Refresh failed') });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE] || req.body?.refreshToken;
    if (raw) await revokeRefreshToken(raw);
    // Invalidate all sessions for this manager (token_version bump)
    await revokeAllRefreshTokens(req.manager.id);
    clearAuthCookies(res);
    res.json({ ok: true });
  } catch (err) {
    logServerError('[auth/logout]', err);
    clearAuthCookies(res);
    res.status(500).json({ message: safeClientError(err, 'Logout failed') });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.manager });
});

export default router;
