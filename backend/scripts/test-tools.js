import dotenv from 'dotenv';
import { query } from '../src/config/db.js';
import { executeTool } from '../src/tools/index.js';

dotenv.config();

async function main() {
  const name = process.argv[2] || 'Jeevan';
  const { rows } = await query(`SELECT id, email, name, role FROM managers LIMIT 1`);
  if (!rows[0]) {
    console.error('No manager seeded. Run npm run seed first.');
    process.exit(1);
  }
  const manager = rows[0];
  console.log('Using manager:', manager.email);
  console.log('--- get_employee_status ---');
  console.log(JSON.stringify(await executeTool('get_employee_status', { name }, manager), null, 2));
  console.log('--- get_team_summary ---');
  console.log(JSON.stringify(await executeTool('get_team_summary', {}, manager), null, 2));
  console.log('--- get_interview_schedule ---');
  console.log(JSON.stringify(await executeTool('get_interview_schedule', {}, manager), null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
