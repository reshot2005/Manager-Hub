import dotenv from 'dotenv';
import { runFullSync } from '../src/sync/index.js';

dotenv.config();

runFullSync()
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
