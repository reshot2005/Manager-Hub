# Manager AI Hub

Private manager-only web app that syncs **Sprintboard** (tasks + EOD) and **ATS** (candidates + interviews) into one Postgres store, then answers questions via **Gemini Flash** tool-calling.

Example: *"What is Jeevan's task and is it completed?"* → tools query the hub DB → grounded reply (no invented statuses).

## Architecture

**Sync, don't query live.** The AI never touches ATS-prod or Sprintboard-prod databases/APIs at chat time.

```
Source Postgres (read-only)  →  Sync jobs (cron */15, parallel)  →  manager-hub Postgres
                                                                     ↓
Manager chat → Gemini Flash (function calling) → fixed tools → hub DB → answer
```

Preferred sync mode: set `SPRINTBOARD_DATABASE_URL` + `ATS_DATABASE_URL` (external hosts).
HTTP API sync is the fallback if those are empty.

- Source credentials stay server-side in sync jobs only
- Tools are fixed SQL functions scoped by `manager_teams` (JWT `managerId` injected — never from the LLM)
- EOD text is sanitized before entering Gemini context (prompt-injection hygiene)
- Sync failures are logged per-source and do not crash the API

## Prerequisites

- Node.js 20+
- PostgreSQL
- Running Sprintboard (`sprintboard-prod`) and/or ATS (`ATS-prod`) with service-account credentials
- [Google AI Studio](https://aistudio.google.com/apikey) API key (Gemini Flash)

## Local Postgres (Docker)

If you don't have Postgres locally:

```bash
docker run -d --name manager-hub-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=manager_hub -p 5433:5432 postgres:16-alpine
```

Then set `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/manager_hub` in `backend/.env`.

## Quick start

### 1. Create database

```bash
createdb manager_hub
# or: psql -c "CREATE DATABASE manager_hub;"
```

### 2. Backend

```bash
cd manager-hub/backend
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET (32+ chars), GEMINI_API_KEY,
# SEED_MANAGER_PASSWORD (required once), SPRINTBOARD_* and ATS_* credentials

npm install
npm run db:init
npm run seed
npm run demo:seed     # optional sample data (Jeevan, candidates, etc.)
npm run sync          # optional: pull from Sprintboard + ATS now
npm run backup        # optional: logical hub backup
npm run dev           # http://localhost:4100
```

Seeded manager (set password via `SEED_MANAGER_PASSWORD` — never committed):

- Email: `manager@hub.local` (or `SEED_MANAGER_EMAIL`)
- Role: `ADMIN`

See `docs/SECURITY.md` and `docs/BACKUP_RESTORE.md` for production hardening.
### 3. Frontend

```bash
cd manager-hub/frontend
cp .env.example .env
npm install
npm run dev           # http://localhost:5173
```

Sign in → **Chat** to ask about employees/candidates, or browse **Employees** / **Candidates** / **Sync**.

## Env reference (`backend/.env`)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Hub Postgres connection |
| `PORT` | API port (default `4100`) |
| `JWT_SECRET` | Hub auth signing key |
| `CORS_ORIGIN` | Frontend origin |
| `GEMINI_API_KEY` | Google AI Studio key |
| `GEMINI_MODEL` | Default `gemini-2.0-flash` |
| `SPRINTBOARD_URL` | e.g. `http://localhost:5000/api/v1` |
| `SPRINTBOARD_EMAIL` / `PASSWORD` | Admin or Team Lead service user |
| `ATS_URL` | e.g. `http://localhost:4000/api` |
| `ATS_EMAIL` / `PASSWORD` | SUPER_ADMIN or RECRUITER |
| `SYNC_CRON` | Default `*/10 * * * *` (set `off` to disable) |
| `SYNC_EOD_LOOKBACK_DAYS` | Days of EOD history to pull |

## AI tools

| Tool | Use |
|------|-----|
| `getEmployeeStatus` | Open tasks + latest EOD (team-scoped) |
| `getPendingTasks` | Incomplete tasks |
| `getLatestEod` | Recent daily reports |
| `getCandidateStatus` | Applications + interviews |
| `getInterviewSchedule` | By date range and/or name |
| `getTeamSummary` | Daily digest |
| `searchPeople` | Name disambiguation |

All tools query **hub Postgres only**, filtered through `manager_teams`.

Test tools without the UI:

```bash
cd backend
npm run test:tools -- Jeevan
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run db:init` | Apply SQL schema |
| `npm run seed` | Create admin manager |
| `npm run sync` | One-shot Sprintboard + ATS sync |
| `npm run test:tools` | Exercise query tools |
| `npm run dev` | API with `--watch` |

## Security notes

- Hub managers are separate from Sprintboard/ATS logins.
- Sync credentials stay server-side only.
- Chat is rate-limited; Gemini only sees tool result payloads, not the full DB.
- Admins can trigger manual sync; managers see scoped team data when links are configured.

## Out of scope (v1)

- WhatsApp
- Writing back into Sprintboard/ATS
- Vector RAG over PDFs
# Manager-Hub

# manager-hub
