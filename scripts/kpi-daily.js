#!/usr/bin/env node
/**
 * Daily KPI Script
 *
 * Calculates yesterday's KPIs from the database and writes them
 * to the Google Sheet for the given profile.
 *
 * Usage:
 *   node scripts/kpi-daily.js --profile katessence
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Load env from dmresponder (where Google keys are configured)
dotenv.config({ path: path.join(PROJECT_ROOT, 'agents', 'dmresponder', '.env') });

const DB_PATH = path.join(PROJECT_ROOT, 'agents', 'collector', 'permanent-data', 'leads.db');

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
];

// ============================================
// CLI
// ============================================

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { profile: null, week: false, from: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
      i++;
    } else if (args[i] === '--week') {
      result.week = true;
    } else if (args[i] === '--from' && args[i + 1]) {
      result.from = args[i + 1];
      result.week = true; // --from implies multi-day mode
      i++;
    }
  }
  return result;
}

/**
 * Returns an array of dates for the current week (Monday to today)
 * @returns {Date[]}
 */
function getCurrentWeekDates() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(today);
  monday.setDate(today.getDate() + mondayOffset);

  const dates = [];
  const current = new Date(monday);
  while (current <= today) {
    dates.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ============================================
// DATABASE
// ============================================

function getAccountId(db, profileName) {
  const row = db.prepare(`
    SELECT id FROM accounts
    WHERE LOWER(description) LIKE ? OR LOWER(ig_username) LIKE ?
  `).get(`%${profileName.toLowerCase()}%`, `%${profileName.toLowerCase()}%`);

  if (!row) throw new Error(`Account not found for profile "${profileName}"`);
  return row.id;
}

function calculateKPIs(db, accountId, dateStr) {
  // 1. Personnes contactées (hors follow-ups): distinct leads who received a non-followup assistant message that day
  const contacted = db.prepare(`
    SELECT COUNT(DISTINCT c.lead_id) as count
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.role = 'assistant'
      AND l.account_id = ?
      AND date(c.sent_at) = ?
      AND (c.message_type IS NULL OR c.message_type NOT LIKE 'followup_%')
  `).get(accountId, dateStr);

  // 2. Réponses: distinct leads who sent a user message that day
  const replies = db.prepare(`
    SELECT COUNT(DISTINCT c.lead_id) as count
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.role = 'user'
      AND l.account_id = ?
      AND date(c.sent_at) = ?
  `).get(accountId, dateStr);

  // 3. RDV Proposés: assistant messages proposing a call that day
  const rdvProposed = db.prepare(`
    SELECT COUNT(DISTINCT c.lead_id) as count
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.role = 'assistant'
      AND l.account_id = ?
      AND date(c.sent_at) = ?
      AND (c.message_text LIKE '%30 min%'
        OR c.message_text LIKE '%appel%'
        OR c.message_text LIKE '%session ensemble%'
        OR c.message_text LIKE '%créneau%'
        OR c.message_text LIKE '%creneau%'
        OR c.message_text LIKE '%se call%')
  `).get(accountId, dateStr);

  // 4. Books confirmed that day (use booking_status + updated_at, as booking_confirmed_at is often empty)
  const books = db.prepare(`
    SELECT COUNT(*) as count
    FROM leads
    WHERE account_id = ?
      AND booking_status = 'completed'
      AND date(updated_at) = ?
  `).get(accountId, dateStr);

  // 5. Vidéos YouTube envoyées
  const youtubeVideos = db.prepare(`
    SELECT COUNT(*) as count
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.role = 'assistant'
      AND l.account_id = ?
      AND date(c.sent_at) = ?
      AND (c.message_text LIKE '%youtube.com%' OR c.message_text LIKE '%youtu.be%')
  `).get(accountId, dateStr);

  // 6. Nombre de suivis (follow-ups) envoyés ce jour
  const followups = db.prepare(`
    SELECT COUNT(*) as count
    FROM conversations c
    JOIN leads l ON c.lead_id = l.id
    WHERE c.role = 'assistant'
      AND l.account_id = ?
      AND date(c.sent_at) = ?
      AND c.message_type LIKE 'followup_%'
  `).get(accountId, dateStr);

  return {
    contacted: contacted.count || 0,
    followups: followups.count || 0,
    replies: replies.count || 0,
    rdvProposed: rdvProposed.count || 0,
    books: books.count || 0,
    youtubeVideos: youtubeVideos.count || 0
  };
}

// ============================================
// GOOGLE SHEETS
// ============================================

async function getGoogleSheetsClient(profileName) {
  const keyPath = process.env[`GOOGLE_SERVICE_ACCOUNT_KEY_${profileName.toUpperCase()}`]
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;

  if (!keyPath) {
    throw new Error(`No Google service account key found for profile ${profileName}. Set GOOGLE_SERVICE_ACCOUNT_KEY_${profileName.toUpperCase()}`);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });

  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

function getSheetId(profileName) {
  const envKey = `GOOGLE_SHEET_ID_${profileName.toUpperCase()}`;
  const sheetId = process.env[envKey];
  if (!sheetId) {
    throw new Error(`No Google Sheet ID found. Set ${envKey} in your .env file.`);
  }
  return sheetId;
}

async function writeKPIsToSheet(sheets, spreadsheetId, date, kpis) {
  const monthIndex = date.getMonth();
  const day = date.getDate();
  const sheetName = MONTH_NAMES[monthIndex];
  const row = day + 1; // Row 1 = header, Row 2 = day 1

  // Columns: B=Contactés (hors followups), C=Suivis, D=Suivi abonnés (vide), E=Réponses, F=Taux (auto, skip), G=YouTube, H=RDV, I=Books
  // Write B:E then skip F (formula) then G:I
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetName}'!B${row}:E${row}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[kpis.contacted, kpis.followups, '', kpis.replies]] }
  });
  const range = `'${sheetName}'!G${row}:I${row}`;
  const values = [[
    kpis.youtubeVideos,
    kpis.rdvProposed,
    kpis.books
  ]];

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values }
  });

  console.log(`✅ Written to "${sheetName}" row ${row} (day ${day}): ${JSON.stringify(kpis)}`);
}

// ============================================
// MAIN
// ============================================

async function main() {
  const { profile, week } = parseArgs();
  if (!profile) {
    console.error('Usage: node scripts/kpi-daily.js --profile <profile_name> [--week]');
    process.exit(1);
  }

  console.log(`📊 KPI Daily Report — profile: ${profile}${week ? ' (week mode)' : ''}`);

  const db = new Database(DB_PATH, { readonly: true });
  const accountId = getAccountId(db, profile);
  console.log(`🔍 Account ID: ${accountId}`);

  const sheets = await getGoogleSheetsClient(profile);
  const spreadsheetId = getSheetId(profile);

  // Determine which dates to process
  const { from } = parseArgs();
  let dates;
  if (from) {
    // --from YYYY-MM-DD: from that date to today
    const start = new Date(from + 'T00:00:00');
    const today = new Date();
    dates = [];
    const current = new Date(start);
    while (current <= today) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
  } else if (week) {
    dates = getCurrentWeekDates();
    console.log(`📅 Week mode: ${dates.length} days (${dates[0].toISOString().split('T')[0]} → ${dates[dates.length - 1].toISOString().split('T')[0]})`);
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    dates = [yesterday];
    console.log(`📅 Date: ${yesterday.toISOString().split('T')[0]}`);
  }

  for (const date of dates) {
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const kpis = calculateKPIs(db, accountId, dateStr);
    console.log(`📈 ${dateStr}:`, kpis);
    await writeKPIsToSheet(sheets, spreadsheetId, date, kpis);
  }

  db.close();
  console.log('✅ Done!');
}

main().catch(err => {
  console.error('❌ KPI Daily Error:', err.message);
  process.exit(1);
});
