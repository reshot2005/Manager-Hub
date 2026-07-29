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
    // Keep SELECT to base columns — optional security columns may be missing pre-migrate
    const { rows } = await query(
      `SELECT id, email, name, role, is_active FROM managers WHERE id = $1`,
      [payload.id]
    );
    const manager = rows[0];
    if (!manager || !manager.is_active) {
      return res.status(401).json({ message: 'Invalid or inactive account' });
    }
    req.manager = {
      id: manager.id,
      email: manager.email,
      name: manager.name,
      role: manager.role,
      token_version: payload.tv ?? 0,
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
