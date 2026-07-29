# Security — Manager Hub

Production hardening notes. Code implements app-layer controls; **platform settings below require manual action**.

## Secrets (rotate immediately if ever committed or shared)

| Secret | Action |
|--------|--------|
| `JWT_SECRET` | Generate 32+ random bytes; set in Vercel/Doppler; never commit |
| `GEMINI_API_KEY` | Rotate in Google AI Studio if exposed |
| `DATABASE_URL` | Neon: reset password / rotate connection string |
| Source DB URLs | Prefer **read-only** roles for Sprintboard / ATS / Attendance |
| `CRON_SECRET` | Random hex; required for sync/backup cron |
| `SEED_MANAGER_PASSWORD` | Set once; remove from env after first seed; use `SEED_MANAGER_PASSWORD_FORCE=true` only to rotate |

**Do not** put secrets in frontend `VITE_*` vars.

Recommended production injection: **Vercel Environment Variables** or **Doppler/Vault** → runtime env. Local `.env` is gitignored.

## Database (manual)

1. Hub Neon: enable **IP allowlist** / private networking so the DB is not open to the whole internet.
2. Create an app role with DML on hub tables only — **not** `neondb_owner` / superuser.
3. Source sync URLs: create **SELECT-only** users on Sprintboard/ATS/Attendance.
4. Optional: `DB_SSL_REJECT_UNAUTHORIZED=true` after configuring CA trust.

## WAF / edge (manual)

- Vercel: enable **Attack Challenge Mode** / Bot Protection where available.
- Or put Cloudflare (or similar) in front with WAF rules + HTTPS only.

## Auth model

- Passwords: **bcrypt** cost 12.
- Access JWT: short-lived (`JWT_EXPIRES_IN=15m`) + **refresh tokens** (hashed in DB).
- Cookies: `HttpOnly`, `Secure` (prod), `SameSite=Strict` (prod) / `Lax` (local).
- Logout revokes refresh tokens and bumps `token_version` (invalidates access JWTs).
- Login: rate limit + lockout after repeated failures.

## Backups

See [BACKUP_RESTORE.md](./BACKUP_RESTORE.md). Cron: `/api/backup/cron` every 3 days (`vercel.json`).

## Dependency notes

- Backend: `npm audit` clean after `node-cron@4`.
- Frontend: `react-router` advisory GHSA-qwww-vcr4-c8h2 (RSC CSRF) — Manager Hub is a **Vite SPA** (no RSC server actions). Track upstream `react-router-dom` releases and upgrade when a patched 7.x/8.x `react-router-dom` is published.