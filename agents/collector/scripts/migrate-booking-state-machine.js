#!/usr/bin/env node

/**
 * Migration: Booking State Machine
 *
 * Adds columns to support the booking state machine:
 * - booking_status: Current state (proposed, pending, confirmed, completed, cancelled, failed)
 * - booking_intent: JSON storing {slot, email, phone} from LLM
 * - booking_attempts: Number of Calendly API attempts
 * - booking_url: Calendly booking URL if created
 * - booking_confirmed_at: Timestamp when booking was confirmed
 *
 * Run: node scripts/migrate-booking-state-machine.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '..', 'permanent-data', 'leads.db');
const db = new Database(dbPath);

console.log('🔄 Running migration: Booking State Machine\n');

const migrations = [
  {
    name: 'Add booking_intent column',
    sql: `ALTER TABLE leads ADD COLUMN booking_intent TEXT DEFAULT NULL`,
    check: `SELECT COUNT(*) as count FROM pragma_table_info('leads') WHERE name = 'booking_intent'`
  },
  {
    name: 'Add booking_attempts column',
    sql: `ALTER TABLE leads ADD COLUMN booking_attempts INTEGER DEFAULT 0`,
    check: `SELECT COUNT(*) as count FROM pragma_table_info('leads') WHERE name = 'booking_attempts'`
  },
  {
    name: 'Add booking_url column',
    sql: `ALTER TABLE leads ADD COLUMN booking_url TEXT DEFAULT NULL`,
    check: `SELECT COUNT(*) as count FROM pragma_table_info('leads') WHERE name = 'booking_url'`
  },
  {
    name: 'Add booking_confirmed_at column',
    sql: `ALTER TABLE leads ADD COLUMN booking_confirmed_at TEXT DEFAULT NULL`,
    check: `SELECT COUNT(*) as count FROM pragma_table_info('leads') WHERE name = 'booking_confirmed_at'`
  }
];

let migrated = 0;
let skipped = 0;

for (const migration of migrations) {
  const existing = db.prepare(migration.check).get();

  if (existing.count > 0) {
    console.log(`   ⏭️  ${migration.name} — already exists`);
    skipped++;
    continue;
  }

  try {
    db.prepare(migration.sql).run();
    console.log(`   ✅ ${migration.name}`);
    migrated++;
  } catch (error) {
    if (error.message.includes('duplicate column')) {
      console.log(`   ⏭️  ${migration.name} — already exists`);
      skipped++;
    } else {
      console.error(`   ❌ ${migration.name} — ${error.message}`);
    }
  }
}

// Verify booking_status column exists (from previous migration)
const bookingStatusExists = db.prepare(
  `SELECT COUNT(*) as count FROM pragma_table_info('leads') WHERE name = 'booking_status'`
).get();

if (bookingStatusExists.count === 0) {
  try {
    db.prepare(`ALTER TABLE leads ADD COLUMN booking_status TEXT DEFAULT NULL`).run();
    console.log(`   ✅ Add booking_status column`);
    migrated++;
  } catch (error) {
    if (!error.message.includes('duplicate column')) {
      console.error(`   ❌ Add booking_status column — ${error.message}`);
    }
  }
}

// Create index for booking queries
try {
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_leads_booking_status ON leads(booking_status)`).run();
  console.log(`   ✅ Create booking_status index`);
} catch (error) {
  console.log(`   ⏭️  Index already exists`);
}

console.log(`\n✅ Migration complete: ${migrated} applied, ${skipped} skipped`);

// Show current schema
console.log('\n📋 Current leads table booking columns:');
const columns = db.prepare(`
  SELECT name, type, dflt_value
  FROM pragma_table_info('leads')
  WHERE name LIKE 'booking%'
`).all();

columns.forEach(col => {
  console.log(`   - ${col.name} (${col.type}) default: ${col.dflt_value || 'NULL'}`);
});

db.close();
