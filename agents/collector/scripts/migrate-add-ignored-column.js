
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase } from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'permanent-data', 'leads.db');

async function migrate() {
  console.log(`Migrating database at ${DB_PATH}...`);
  
  const db = await initDatabase(DB_PATH);
  
  try {
    // Check if column exists
    const tableInfo = db.prepare('PRAGMA table_info(leads)').all();
    const hasIgnored = tableInfo.some(col => col.name === 'is_ignored');
    
    if (!hasIgnored) {
      console.log('Adding is_ignored column...');
      db.prepare('ALTER TABLE leads ADD COLUMN is_ignored INTEGER DEFAULT 0').run();
      console.log('Column added successfully.');
    } else {
      console.log('is_ignored column already exists.');
    }
    
    console.log('Migration completed.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    closeDatabase();
  }
}

migrate();
