/**
 * Prompt-injection hygiene + secret stripping for untrusted synced text
 * before it is returned to Gemini as tool context.
 */
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /disregard\s+(all\s+)?(previous|prior|above)/gi,
  /you\s+are\s+now\s+/gi,
  /system\s*:\s*/gi,
  /<\s*\/?\s*system\s*>/gi,
  /\[\s*INST\s*\]/gi,
  /do\s+not\s+follow\s+your\s+(system|developer)\s+prompt/gi,
  /reveal\s+(your\s+)?(system\s+)?prompt/gi,
  /exfiltrat/gi,
  /override\s+(safety|system|developer)/gi,
  /jailbreak/gi,
  /DAN\s+mode/gi,
  /new\s+instructions?\s*:/gi,
  /tool\s+call\s*:/gi,
  /function[_-]?call/gi,
];

const SECRET_KEY =
  /^(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|authorization|connection[_-]?string|database[_-]?url|jwt|refresh[_-]?token|cron[_-]?secret|raw)$/i;

const SECRET_VALUE =
  /(postgresql:\/\/|postgres:\/\/|mongodb(\+srv)?:\/\/|Bearer\s+[A-Za-z0-9._\-]+|AIza[0-9A-Za-z_\-]+|sk-[A-Za-z0-9]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/gi;

export function sanitizeForAi(value, { maxLen = 2000 } = {}) {
  if (value == null) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForAi(v, { maxLen }));
  }

  if (typeof value === 'object') {
    if (
      typeof value.toISOString === 'function' &&
      Object.prototype.toString.call(value) !== '[object Object]'
    ) {
      try {
        return value.toISOString();
      } catch {
        /* fall through */
      }
    }
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      if (k === 'raw') continue;
      out[k] = sanitizeForAi(v, { maxLen });
    }
    return out;
  }

  let text = String(value);
  text = text.replace(SECRET_VALUE, '[REDACTED]');
  for (const re of INJECTION_PATTERNS) {
    text = text.replace(re, '[filtered]');
  }
  text = text.replace(/```/g, "'''");
  if (text.length > maxLen) {
    text = `${text.slice(0, maxLen)}…`;
  }
  return text;
}
