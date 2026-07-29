import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { hashToken, randomToken } from './auditLog.js';

const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_DAYS = Number(process.env.JWT_REFRESH_DAYS || 7);

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.includes('replace_with')) {
    throw new Error('JWT_SECRET must be configured');
  }
  if (
    secret.length < 32 &&
    (process.env.VERCEL || process.env.NODE_ENV === 'production')
  ) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  return secret;
}

export function signAccessToken(manager) {
  return jwt.sign(
    {
      id: manager.id,
      role: manager.role,
      email: manager.email,
      tv: manager.token_version ?? 0,
      typ: 'access',
    },
    requireJwtSecret(),
    { expiresIn: ACCESS_TTL }
  );
}

/** @deprecated use signAccessToken */
export function signToken(manager) {
  return signAccessToken(manager);
}

export function verifyToken(token) {
  const payload = jwt.verify(token, requireJwtSecret());
  if (payload.typ && payload.typ !== 'access') {
    throw new Error('Invalid token type');
  }
  return payload;
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function issueRefreshToken(managerId, meta = {}) {
  const raw = randomToken(48);
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400000);
  await query(
    `INSERT INTO refresh_tokens (manager_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [managerId, tokenHash, expiresAt, meta.userAgent || null, meta.ip || null]
  );
  return { refreshToken: raw, expiresAt };
}

export async function rotateRefreshToken(rawRefresh, meta = {}) {
  const tokenHash = hashToken(rawRefresh);
  const { rows } = await query(
    `SELECT id, manager_id, expires_at, revoked_at
     FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row || row.revoked_at || new Date(row.expires_at) < new Date()) {
    return null;
  }

  await query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1`, [row.id]);

  const { rows: managers } = await query(
    `SELECT id, email, name, role, is_active, token_version,
            locked_until, failed_login_attempts
     FROM managers WHERE id = $1`,
    [row.manager_id]
  );
  const manager = managers[0];
  if (!manager?.is_active) return null;
  if (manager.locked_until && new Date(manager.locked_until) > new Date()) return null;

  const next = await issueRefreshToken(manager.id, meta);
  return { manager, ...next };
}

export async function revokeRefreshToken(rawRefresh) {
  if (!rawRefresh) return;
  const tokenHash = hashToken(rawRefresh);
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
}

export async function revokeAllRefreshTokens(managerId) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE manager_id = $1 AND revoked_at IS NULL`,
    [managerId]
  );
  await query(
    `UPDATE managers SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
    [managerId]
  );
}

export function cookieOptions(maxAgeMs) {
  const isProd = Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd || process.env.COOKIE_SECURE === 'true',
    sameSite: isProd ? 'strict' : 'lax',
    path: '/',
    maxAge: maxAgeMs,
  };
}

export const ACCESS_COOKIE = 'hub_access';
export const REFRESH_COOKIE = 'hub_refresh';
