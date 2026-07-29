/**
 * Never leak stack traces / SQL / paths to clients.
 */
export function safeClientError(err, fallback = 'Request failed') {
  if (process.env.NODE_ENV !== 'production' && process.env.EXPOSE_ERROR_DETAILS === 'true') {
    return err?.message || fallback;
  }
  return fallback;
}

export function logServerError(tag, err) {
  const msg = err?.message || String(err);
  // Redact connection strings / secrets if they appear in error text
  const redacted = msg
    .replace(/postgresql:\/\/[^\s]+/gi, 'postgresql://[REDACTED]')
    .replace(/postgres:\/\/[^\s]+/gi, 'postgres://[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED_KEY]')
    .replace(/sk-[A-Za-z0-9]+/g, '[REDACTED_KEY]');
  console.error(tag, redacted);
}
