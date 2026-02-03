#!/usr/bin/env node
/**
 * Migration: Add funnel_step column to leads table
 *
 * This script adds the funnel_step column to track sales funnel progression
 * separately from conversation_step (which tracks message counts).
 *
 * Usage: node scripts/migrate-add-funnel-step.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('=== Migration: Add funnel_step column ===\n');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);

  try {
    // Check if column already exists
    const columns = db.prepare("PRAGMA table_info(leads)").all();
    const hasFunnelStep = columns.some(c => c.name === 'funnel_step');

    if (hasFunnelStep) {
      console.log('✅ Column funnel_step already exists. Nothing to do.\n');
      return;
    }

    console.log('Adding funnel_step column to leads table...');

    db.exec(`
      ALTER TABLE leads ADD COLUMN funnel_step INTEGER DEFAULT 0;
    `);

    console.log('✅ Column added successfully.\n');

    // Initialize funnel_step based on existing data
    console.log('Initializing funnel_step for existing leads...\n');

    // Leads who have been contacted get step 1
    const contacted = db.prepare(`
      UPDATE leads SET funnel_step = 1
      WHERE total_messages_sent > 0 AND funnel_step = 0
    `).run();
    console.log(`   Set funnel_step=1 for ${contacted.changes} contacted leads`);

    // Leads who have replied get step 2
    const replied = db.prepare(`
      UPDATE leads SET funnel_step = 2
      WHERE total_messages_received > 0 AND funnel_step < 2
    `).run();
    console.log(`   Set funnel_step=2 for ${replied.changes} replied leads`);

    // Leads with ongoing conversation (multiple exchanges) get step 3
    const ongoing = db.prepare(`
      UPDATE leads SET funnel_step = 3
      WHERE total_messages_received > 1 AND total_messages_sent > 1 AND funnel_step < 3
    `).run();
    console.log(`   Set funnel_step=3 for ${ongoing.changes} leads with ongoing conversations`);

    // Qualified leads get step 5 (assuming they've been proposed a call)
    const qualified = db.prepare(`
      UPDATE leads SET funnel_step = 5
      WHERE status = 'qualified' AND funnel_step < 5
    `).run();
    console.log(`   Set funnel_step=5 for ${qualified.changes} qualified leads`);

    // Converted leads get step 8 (booking confirmed)
    const converted = db.prepare(`
      UPDATE leads SET funnel_step = 8
      WHERE status = 'converted' OR booking_status = 'completed'
    `).run();
    console.log(`   Set funnel_step=8 for ${converted.changes} converted leads`);

    console.log('\n✅ Migration complete!\n');

    // Show summary
    const summary = db.prepare(`
      SELECT funnel_step, COUNT(*) as count
      FROM leads
      GROUP BY funnel_step
      ORDER BY funnel_step
    `).all();

    console.log('Funnel step distribution:');
    for (const row of summary) {
      console.log(`   Step ${row.funnel_step}: ${row.count} leads`);
    }
    console.log('');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

migrate();
