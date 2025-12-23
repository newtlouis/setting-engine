
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, closeDatabase, getDatabase } from '../src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'permanent-data', 'leads.db');

async function backfill() {
  console.log(`Backfilling lead_source from comments in ${DB_PATH}...`);
  
  const db = await initDatabase(DB_PATH);
  
  try {
    // Update leads where lead_source is null or empty
    // We take the most recent non-empty source from comments for each lead
    const updateStmt = db.prepare(`
      UPDATE leads 
      SET lead_source = (
        SELECT source 
        FROM comments 
        WHERE lead_id = leads.id AND source IS NOT NULL AND source != ''
        ORDER BY comment_date DESC 
        LIMIT 1
      )
      WHERE lead_source IS NULL OR lead_source = ''
    `);
    
    const result = updateStmt.run();
    console.log(`✅ Backfilled ${result.changes} leads.`);
    
    // Also, let's check for any leads that still don't have a source
    const missing = db.prepare("SELECT COUNT(*) as count FROM leads WHERE lead_source IS NULL OR lead_source = ''").get();
    if (missing.count > 0) {
      console.log(`⚠️  ${missing.count} leads still missing a source (no comments found).`);
    }

    console.log('Backfill completed successfully.');
  } catch (error) {
    console.error('Backfill failed:', error);
  } finally {
    closeDatabase();
  }
}

backfill();
