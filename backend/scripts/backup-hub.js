#!/usr/bin/env node
/**
 * Manual / scheduled hub backup.
 * Usage: node scripts/backup-hub.js
 * Cron (every 3 days): curl -H "x-cron-secret: $CRON_SECRET" https://app/api/backup/cron
 */
import dotenv from 'dotenv';
dotenv.config();

const { ensureBootstrap } = await import('../src/services/bootstrap.js');
const { runHubBackup } = await import('../src/services/backup.js');

await ensureBootstrap();
const result = await runHubBackup({ trigger: 'cli' });
console.log(JSON.stringify({ ok: result.ok, filename: result.filename, bytes: result.bytes }, null, 2));
process.exit(0);
