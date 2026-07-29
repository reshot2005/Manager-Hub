import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createApp } from '../backend/src/app.js';
import serverless from 'serverless-http';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../backend/.env') });

const app = createApp();

export default serverless(app, {
  binary: false,
});
