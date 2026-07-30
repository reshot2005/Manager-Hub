import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../config/db.js';
import { hashPassword } from '../utils/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbDir = join(__dirname, '../db');

let bootstrapped = false;
let bootstrapping = null;

async function runSqlFile(name) {
  const sql = readFileSync(join(dbDir, name), 'utf8');
  await query(sql);
}

async function tablesReady() {
  const { rows } = await query(`
    SELECT
      to_regclass('public.managers') IS NOT NULL AS managers,
      to_regclass('public.refresh_tokens') IS NOT NULL AS refresh_tokens
  `);
  return rows[0];
}

/**
 * Idempotent: schema migrations + manager seed.
 * On Vercel request path: if schema already exists, skip heavy SQL + ACL linking
 * (ACL is refreshed by sync/cron instead) so login stays fast.
 */
export async function ensureBootstrap({ light = Boolean(process.env.VERCEL) } = {}) {
  if (bootstrapped) return { ok: true, skipped: true };
  if (bootstrapping) return bootstrapping;

  bootstrapping = (async () => {
    const ready = await tablesReady().catch(() => ({ managers: false, refresh_tokens: false }));

    if (!ready.managers) {
      await runSqlFile('schema.sql');
    } else if (!light) {
      // Local / cron: keep migrations current
      await runSqlFile('schema.sql');
    }

    // Always try lightweight security migration (IF NOT EXISTS)
    try {
      await runSqlFile('migrate_security.sql');
    } catch (err) {
      console.warn('[bootstrap] security:', err.message?.slice(0, 120));
    }

    if (!light) {
      try {
        await runSqlFile('migrate_acl.sql');
      } catch (err) {
        console.warn('[bootstrap] ACL:', err.message?.slice(0, 120));
      }
      try {
        await runSqlFile('migrate_attendance.sql');
      } catch (err) {
        console.warn('[bootstrap] attendance:', err.message?.slice(0, 120));
      }
      try {
        await runSqlFile('migrate_shifts.sql');
      } catch (err) {
        console.warn('[bootstrap] shifts:', err.message?.slice(0, 120));
      }
      try {
        await runSqlFile('migrate_leave_risk_alerts.sql');
      } catch (err) {
        console.warn('[bootstrap] leave/risk/alerts:', err.message?.slice(0, 120));
      }
    }

    const manager = await ensureManagerSeed();
    // Heavy ACL fan-out only outside hot request path (sync/cron/local)
    if (manager?.id && !light) {
      await linkAdminAcl(manager.id);
    }

    bootstrapped = true;
    console.log('[bootstrap] hub ready · manager', manager?.email || '(none)', light ? '(light)' : '');
    return { ok: true, light, manager: manager?.email ? { email: manager.email, role: manager.role } : null };
  })();

  try {
    return await bootstrapping;
  } finally {
    bootstrapping = null;
  }
}

export async function ensureManagerSeed() {
  const email = (process.env.SEED_MANAGER_EMAIL || 'manager@hub.local').toLowerCase();
  const name = process.env.SEED_MANAGER_NAME || 'Hub Manager';
  const password = process.env.SEED_MANAGER_PASSWORD;
  const forceReset = process.env.SEED_MANAGER_PASSWORD_FORCE === 'true';

  const existing = await query(
    `SELECT id, email, name, role FROM managers WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (existing.rows[0]) {
    const manager = existing.rows[0];
    if (forceReset && password) {
      const passwordHash = await hashPassword(password);
      await query(
        `UPDATE managers SET password_hash = $2, name = $3, role = 'ADMIN',
           is_active = TRUE, token_version = COALESCE(token_version, 0) + 1, updated_at = NOW()
         WHERE id = $1`,
        [manager.id, passwordHash, name]
      );
    }
    await query(
      `INSERT INTO manager_team_links (manager_id, scope)
       SELECT $1, 'ALL'
       WHERE NOT EXISTS (
         SELECT 1 FROM manager_team_links WHERE manager_id = $1 AND scope = 'ALL'
       )`,
      [manager.id]
    );
    return manager;
  }

  if (!password) {
    if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
      console.warn('[bootstrap] No manager seed — set SEED_MANAGER_PASSWORD once to create admin');
      return { id: null, email, role: 'ADMIN' };
    }
    throw new Error(
      'SEED_MANAGER_PASSWORD is required to create the first manager (no default password)'
    );
  }

  const passwordHash = await hashPassword(password);
  const { rows } = await query(
    `INSERT INTO managers (email, password_hash, name, role)
     VALUES ($1, $2, $3, 'ADMIN')
     RETURNING id, email, name, role`,
    [email, passwordHash, name]
  );

  const manager = rows[0];
  await query(
    `INSERT INTO manager_team_links (manager_id, scope)
     SELECT $1, 'ALL'
     WHERE NOT EXISTS (
       SELECT 1 FROM manager_team_links WHERE manager_id = $1 AND scope = 'ALL'
     )`,
    [manager.id]
  );

  return manager;
}

/** Link every employee + candidate to ADMIN managers (keeps ACL current after each sync). */
export async function linkAdminAcl(managerId) {
  if (managerId) {
    await query(
      `INSERT INTO manager_teams (manager_id, employee_id)
       SELECT $1, e.id FROM employees e
       ON CONFLICT DO NOTHING`,
      [managerId]
    );
    await query(
      `INSERT INTO manager_candidate_access (manager_id, candidate_id)
       SELECT $1, c.id FROM candidates c
       ON CONFLICT DO NOTHING`,
      [managerId]
    );
    return;
  }

  await query(`
    INSERT INTO manager_teams (manager_id, employee_id)
    SELECT m.id, e.id FROM managers m
    CROSS JOIN employees e
    WHERE m.role = 'ADMIN' AND m.is_active = TRUE
    ON CONFLICT DO NOTHING
  `);
  await query(`
    INSERT INTO manager_candidate_access (manager_id, candidate_id)
    SELECT m.id, c.id FROM managers m
    CROSS JOIN candidates c
    WHERE m.role = 'ADMIN' AND m.is_active = TRUE
    ON CONFLICT DO NOTHING
  `);
}

/** Reset in-memory flag (tests only). */
export function resetBootstrapFlag() {
  bootstrapped = false;
}
