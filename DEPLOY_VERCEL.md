# Deploy on Vercel (no Docker)

## 1. Hub database (Neon)

1. https://console.neon.tech → **New Project** → name `manager-hub`
2. Copy the connection URI → this is **only** `DATABASE_URL`
3. Do **not** reuse Attendance / ATS Neon URLs as the hub DB

## 2. One-time init from your laptop

In `backend/.env` set `DATABASE_URL`, `JWT_SECRET` (32+ chars), `GEMINI_API_KEY`, source DB URLs, and `SEED_MANAGER_PASSWORD`, then:

```bash
cd backend
npm install
npm run db:init
npm run seed
npm run sync
```

Login locally once to confirm. Remove `SEED_MANAGER_PASSWORD_FORCE` if you used it.

## 3. Push code (already done if you pushed `main`)

Repo: https://github.com/reshot2005/Manager-Hub

## 4. Import in Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import** `reshot2005/Manager-Hub`
2. **Root Directory:** leave blank (repo root)
3. Framework: **Other** (uses `vercel.json`)
4. Build settings are in `vercel.json` — do not override unless needed

## 5. Environment variables (Production + Preview)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Hub Neon URI (`sslmode=require`) |
| `JWT_SECRET` | Yes | 32+ random characters |
| `JWT_EXPIRES_IN` | Yes | `15m` |
| `JWT_REFRESH_DAYS` | Yes | `7` |
| `GEMINI_API_KEY` | Yes | Google AI Studio |
| `GEMINI_MODEL` | Yes | e.g. `gemini-2.5-flash` |
| `CORS_ORIGIN` | Yes | `https://YOUR_PROJECT.vercel.app` (update after first deploy if needed) |
| `CRON_SECRET` | Yes | Random hex (protects sync/backup cron) |
| `SPRINTBOARD_DATABASE_URL` | Yes* | Read-only source |
| `ATTENDANCE_DATABASE_URL` | Yes* | Read-only source |
| `ATS_DATABASE_URL` | Yes* | Read-only source |
| `SEED_MANAGER_EMAIL` | Optional | Only if creating first admin on cold start |
| `SEED_MANAGER_PASSWORD` | Optional | Set once, then remove from Vercel |
| `SYNC_EOD_LOOKBACK_DAYS` | Optional | `60` |
| `SYNC_ATTENDANCE_LOOKBACK_DAYS` | Optional | `90` |
| `BACKUP_RETENTION_CYCLES` | Optional | `5` |

\* Skip a source only if you do not use that product.

**Do not set** `VITE_API_BASE_URL` on Vercel (browser uses same-origin `/api`).

**Never** put `.env` file contents in the repo.

## 6. Deploy

Click **Deploy**. After success:

1. Note the URL → set `CORS_ORIGIN` to that exact `https://…vercel.app` → **Redeploy**
2. Open the site → sign in with your seeded manager
3. Check **Data Sync** (admin) and ask Manager AI for today’s briefing
4. Hit `/api/health` — should return `ok: true`

## 7. Automatic jobs (Hobby-compatible)

Vercel **Hobby** only allows cron schedules that run **at most once per day**.  
More frequent sync needs Pro, or an external ping (below).

| Cron | Path | Purpose |
|------|------|---------|
| Daily 01:00 UTC | `/api/sync/cron` | Pull sources into hub |
| Every 3 days @ 03:00 UTC | `/api/backup/cron` | Logical backup + retention |

**Optional — sync more often on Hobby:** use [cron-job.org](https://cron-job.org) (or similar) hourly:

```bash
curl -X POST "https://YOUR_APP.vercel.app/api/sync/cron" -H "x-cron-secret: YOUR_CRON_SECRET"
```

Vercel Cron also sends `x-vercel-cron: 1`. Manual trigger:

```bash
curl -X POST "https://YOUR_APP.vercel.app/api/sync/cron" -H "x-cron-secret: YOUR_CRON_SECRET"
```

## 8. Security checklist (post-deploy)

- [ ] Neon IP allowlist / least-privilege DB role (see `docs/SECURITY.md`)
- [ ] Rotate any secrets that ever appeared in chat/git
- [ ] Enable Vercel Attack Challenge / WAF if available
- [ ] Remove `SEED_MANAGER_PASSWORD` from Vercel after first successful login
- [ ] Optional: `BACKUP_UPLOAD_URL` for off-server backup storage

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Build fails | Check Vercel build logs; ensure root has `package.json` + `vercel.json` |
| API 500 on login | `DATABASE_URL` / `JWT_SECRET` missing or wrong |
| CORS errors | `CORS_ORIGIN` must match the exact site URL |
| Chat 503 | `GEMINI_API_KEY` missing |
| Empty team data | Run sync locally once, or wait for cron; check source URLs |
| Cron 401 | Expected without Vercel cron header / `CRON_SECRET` |
