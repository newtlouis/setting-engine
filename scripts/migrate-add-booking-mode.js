#!/usr/bin/env node
/**
 * Migration: Add booking_mode and booking_config columns to accounts table
 *
 * Adds support for multi-provider booking (Calendly, Google Calendar).
 * - booking_mode: 'calendly' (default) or 'google_calendar'
 * - booking_config: JSON string with provider-specific config (e.g. calendarId, minHour, maxHour)
 *
 * Usage: node scripts/migrate-add-booking-mode.js
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_PATH = path.join(__dirname, '..', 'agents', 'collector', 'permanent-data', 'leads.db');

async function migrate() {
  console.log('=== Migration: Add booking_mode and booking_config columns ===\n');
  console.log(`Database: ${DB_PATH}\n`);

  const db = new Database(DB_PATH);

  try {
    const columns = db.prepare("PRAGMA table_info(accounts)").all();
    const hasBookingMode = columns.some(c => c.name === 'booking_mode');
    const hasBookingConfig = columns.some(c => c.name === 'booking_config');

    // Add booking_mode column
    if (hasBookingMode) {
      console.log('✅ Column booking_mode already exists. Skipping.\n');
    } else {
      console.log('Adding booking_mode column to accounts table...');
      db.exec(`ALTER TABLE accounts ADD COLUMN booking_mode TEXT DEFAULT 'calendly'`);
      console.log('✅ booking_mode column added.\n');
    }

    // Add booking_config column
    if (hasBookingConfig) {
      console.log('✅ Column booking_config already exists. Skipping.\n');
    } else {
      console.log('Adding booking_config column to accounts table...');
      db.exec(`ALTER TABLE accounts ADD COLUMN booking_config TEXT DEFAULT NULL`);
      console.log('✅ booking_config column added.\n');
    }

    // Set katessence to google_calendar
    const katessence = db.prepare(`SELECT id, name, booking_mode FROM accounts WHERE name = 'katessence'`).get();
    if (katessence) {
      if (katessence.booking_mode !== 'google_calendar') {
        db.prepare(`UPDATE accounts SET booking_mode = 'google_calendar' WHERE id = ?`).run(katessence.id);
        console.log(`✅ Set booking_mode='google_calendar' for account "${katessence.name}" (id=${katessence.id}).\n`);
      } else {
        console.log(`✅ Account "${katessence.name}" already set to google_calendar.\n`);
      }
    } else {
      console.log('⚠️  Account "katessence" not found. Run migrate-katessence-full-config.js first.\n');
    }

    // Show summary
    const accounts = db.prepare(`SELECT name, booking_mode, booking_config FROM accounts`).all();
    console.log('Account booking modes:');
    for (const row of accounts) {
      console.log(`   ${row.name}: ${row.booking_mode || 'calendly (default)'}${row.booking_config ? ' (has config)' : ''}`);
    }
    console.log('');

    console.log('✅ Migration complete!\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

migrate();
