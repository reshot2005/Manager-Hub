import {
  verifyToken,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../utils/auth.js';
import { query } from '../config/db.js';

function extractAccessToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  if (req.cookies?.[ACCESS_COOKIE]) return req.cookies[ACCESS_COOKIE];
  return null;
}

export async function requireAuth(req, res, next) {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const payload = verifyToken(token);
    const { rows } = await query(
      `SELECT id, email, name, role, is_active, token_version, locked_until
       FROM managers WHERE id = $1`,
      [payload.id]
    );
    const manager = rows[0];
    if (!manager || !manager.is_active) {
      return res.status(401).json({ message: 'Invalid or inactive account' });
    }
    if (manager.locked_until && new Date(manager.locked_until) > new Date()) {
      return res.status(423).json({ message: 'Account temporarily locked' });
    }
    const tv = manager.token_version ?? 0;
    if (payload.tv != null && Number(payload.tv) !== Number(tv)) {
      return res.status(401).json({ message: 'Session revoked — please sign in again' });
    }
    req.manager = {
      id: manager.id,
      email: manager.email,
      name: manager.name,
      role: manager.role,
      token_version: tv,
    };
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

export function requireAdmin(req, res, next) {
  if (req.manager?.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
