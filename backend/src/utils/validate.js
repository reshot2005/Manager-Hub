/**
 * Lightweight request body / query validators (no extra dep).
 */

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body?.[f] == null || body[f] === '');
  if (missing.length) {
    return { ok: false, message: `Missing: ${missing.join(', ')}` };
  }
  return { ok: true };
}

export function asEmail(value, { max = 254 } = {}) {
  const s = String(value || '').trim().toLowerCase();
  if (!s || s.length > max) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return null;
  return s;
}

export function asString(value, { max = 500, min = 0 } = {}) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s.length < min || s.length > max) return null;
  return s;
}

export function asUuid(value) {
  const s = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
    return null;
  }
  return s;
}

export function asInt(value, { min = 0, max = 1_000_000 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

export function asDateYmd(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

const ALLOWED_TASK_STATUSES = new Set([
  'Backlog',
  'Todo',
  'In Progress',
  'In Review',
  'Blocked',
  'Done',
  'Cancelled',
]);

export function asTaskStatus(value) {
  const s = String(value || '').trim();
  return ALLOWED_TASK_STATUSES.has(s) ? s : null;
}
