
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to collector's database module
const DB_MODULE_PATH = path.join(__dirname, '..', '..', 'collector', 'src', 'database.js');
const DB_PATH = path.join(__dirname, '..', '..', 'collector', 'permanent-data', 'leads.db');

async function debugLead() {
  const dbModule = await import(DB_MODULE_PATH);
  await dbModule.initDatabase(DB_PATH);
  const db = await dbModule.getDatabase();

  const lead = db.prepare('SELECT * FROM leads WHERE id = 1').get();
  console.log('Lead 1:', lead);

  if (lead) {
      console.log('Lead Status:', lead.status);
      console.log('Profile URL:', lead.profile_url);
      
      const thread = db.prepare('SELECT * FROM dm_threads WHERE lead_id = 1').get();
      console.log('DM Thread:', thread);
  } else {
      console.log('Lead 1 not found.');
  }

  // Check what getTrackedDmThreads would return
  const statuses = ['message_ready', 'awaiting_reply', 'watching'];
  console.log('\nChecking criteria match:');
  console.log(`Status in [${statuses}]:`, statuses.includes(lead?.status));
  console.log('Has Profile URL:', !!lead?.profile_url);
  // Note: getTrackedDmThreads in cron_worker uses dm_url from dm_threads OR profile_url depending on implementation.
  // We need to see the implementation in db_integration.js to be sure.
}

debugLead();
