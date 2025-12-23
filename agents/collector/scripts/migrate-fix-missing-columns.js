
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
    const tableInfo = db.prepare('PRAGMA table_info(leads)').all();
    const columns = tableInfo.map(col => col.name);
    
    const newColumns = [
      { name: 'is_private', type: 'INTEGER DEFAULT 0' },
      { name: 'is_verified', type: 'INTEGER DEFAULT 0' },
      { name: 'is_business', type: 'INTEGER DEFAULT 0' },
      { name: 'followers_count', type: 'INTEGER' },
      { name: 'following_count', type: 'INTEGER' },
      { name: 'posts_count', type: 'INTEGER' },
      { name: 'full_name', type: 'TEXT' },
      { name: 'external_url', type: 'TEXT' },
      { name: 'profile_scraped_at', type: 'TEXT' }
    ];
    
    for (const col of newColumns) {
      if (!columns.includes(col.name)) {
        console.log(`Adding ${col.name} column...`);
        db.prepare(`ALTER TABLE leads ADD COLUMN ${col.name} ${col.type}`).run();
      }
    }
    
    console.log('Migration completed.');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    closeDatabase();
  }
}

migrate();
