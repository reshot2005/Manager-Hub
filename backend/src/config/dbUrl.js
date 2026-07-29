/**
 * Neon / serverless-friendly DATABASE_URL cleanup.
 * - channel_binding=require often hangs node-pg on Vercel
 * - pg v8+ treats sslmode=require as verify-full (needs CA) → hangs without uselibpqcompat
 */
export function normalizeDatabaseUrl(url) {
  if (!url) return url;
  let out = String(url).trim();

  out = out.replace(/([?&])channel_binding=[^&]*&?/gi, '$1');
  out = out.replace(/[?&]$/, '');
  out = out.replace(/\?&/, '?');

  if (/neon\.tech/i.test(out) || process.env.VERCEL) {
    // Reset sslmode / compat flags, then set serverless-safe pair
    out = out.replace(/([?&])sslmode=[^&]*&?/gi, '$1');
    out = out.replace(/([?&])uselibpqcompat=[^&]*&?/gi, '$1');
    out = out.replace(/[?&]$/, '');
    out = out.replace(/\?&/, '?');
    out += out.includes('?') ? '&' : '?';
    out += 'uselibpqcompat=true&sslmode=require';
  }

  return out;
}
