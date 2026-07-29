import crypto from 'crypto';
import { query } from '../config/db.js';

/** Audit AI tool calls without logging sensitive payloads. */
export async function logAiToolCall({ managerId, toolName, args, success = true }) {
  try {
    const argKeys = args && typeof args === 'object' ? Object.keys(args).slice(0, 20) : [];
    await query(
      `INSERT INTO ai_audit_log (manager_id, tool_name, arg_keys, success)
       VALUES ($1, $2, $3, $4)`,
      [managerId || null, String(toolName || 'unknown').slice(0, 120), argKeys, Boolean(success)]
    );
  } catch (err) {
    // Table may not exist until migration — never break chat
    console.warn('[ai-audit]', err.message?.slice(0, 120));
  }
}

/** Hash refresh tokens at rest (never store raw). */
export function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function randomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('base64url');
}
