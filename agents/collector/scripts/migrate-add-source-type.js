
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'permanent-data', 'leads.db');

async function migrate() {
  console.log(`Migrating database at ${DB_PATH}...`);
  
  const db = await initDatabase(DB_PATH);
  
  try {
    // Check if columns exist
    const tableInfo = db.prepare('PRAGMA table_info(leads)').all();
    const hasSource = tableInfo.some(col => col.name === 'lead_source');
    const hasType = tableInfo.some(col => col.name === 'lead_type');
    
    if (!hasSource) {
      console.log('Adding lead_source column...');
      db.prepare('ALTER TABLE leads ADD COLUMN lead_source TEXT').run();
    } else {
      console.log('lead_source column already exists.');
    }
    
    if (!hasType) {
      console.log('Adding lead_type column...');
      db.prepare("ALTER TABLE leads ADD COLUMN lead_type TEXT DEFAULT 'cold'").run();
    } else {
      console.log('lead_type column already exists.');
    }
    
    console.log('Migration completed successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    closeDatabase();
  }
}

migrate();
