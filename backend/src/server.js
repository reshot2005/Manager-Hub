import dotenv from 'dotenv';
import { createApp } from './app.js';
import { startSyncCron, runFullSync } from './sync/index.js';
import { ensureBootstrap } from './services/bootstrap.js';

dotenv.config();

const app = createApp();
const port = Number(process.env.PORT || 4100);

app.listen(port, async () => {
  console.log(`Manager Hub API on http://localhost:${port}`);

  try {
    await ensureBootstrap();
    console.log('[boot] schema + manager seed OK');
  } catch (err) {
    console.error('[boot] bootstrap failed:', err.message);
  }

  // Local: keep hub Neon filled from all source DATABASE_URLs continuously
  if (!process.env.VERCEL && process.env.SYNC_CRON !== 'off') {
    const autoSync = process.env.AUTO_SYNC_ON_START !== 'false';
    if (autoSync) {
      console.log('[boot] pulling Sprintboard + ATS + Attendance into hub…');
      runFullSync()
        .then((r) => console.log('[boot] initial sync done', r.success ? 'OK' : r.errors))
        .catch((err) => console.error('[boot] initial sync failed:', err.message));
    }
    startSyncCron();
  }
});
