import { createApp } from '../backend/src/app.js';
import serverless from 'serverless-http';

// On Vercel, env vars are injected by the platform (no .env file).
// Local `npm run dev` still loads backend/.env via backend/src/config/db.js.

const app = createApp();

export default serverless(app, {
  binary: false,
});
