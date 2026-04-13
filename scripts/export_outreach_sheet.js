#!/usr/bin/env node
/**
 * Export Outreach Queue to Google Sheet
 *
 * Writes all pending leads from outreach_queue for the given profile
 * into a dedicated tab "Outreach Manuel" of the profile's Google Sheet,
 * so the user can manually send DMs from their phone and tick the
 * checkboxes as they go.
 *
 * The tab is cleared and fully rewritten on every run — nothing stale
 * persists. Re-running is safe.
 *
 * Usage:
 *   node scripts/export_outreach_sheet.js --profile katessence
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import Database from 'better-sqlite3';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, 'agents', 'dmresponder', '.env') });

const DB_PATH = path.join(PROJECT_ROOT, 'agents', 'collector', 'permanent-data', 'leads.db');
const TAB_NAME = 'Outreach Manuel';

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { profile: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--profile' && args[i + 1]) {
      result.profile = args[i + 1];
      i++;
    }
  }
  return result;
}

function getAccountId(db, profileName) {
  const row = db.prepare(`
    SELECT id FROM accounts
    WHERE LOWER(description) LIKE ? OR LOWER(ig_username) LIKE ?
  `).get(`%${profileName.toLowerCase()}%`, `%${profileName.toLowerCase()}%`);
  if (!row) throw new Error(`Account not found for profile "${profileName}"`);
  return row.id;
}

function getPendingLeads(db, accountId) {
  return db.prepare(`
    SELECT username, profile_url, prepared_message, first_name, source, created_at
    FROM outreach_queue
    WHERE status = 'pending' AND account_id = ?
    ORDER BY created_at ASC
  `).all(accountId);
}

async function getSheetsClient(profileName) {
  const keyPath = process.env[`GOOGLE_SERVICE_ACCOUNT_KEY_${profileName.toUpperCase()}`]
    || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH;
  if (!keyPath) throw new Error(`Missing GOOGLE_SERVICE_ACCOUNT_KEY_${profileName.toUpperCase()}`);
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
  if (!sheetId) throw new Error(`Missing ${envKey}`);
  return sheetId;
}

async function ensureTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.find(s => s.properties.title === tabName);
  if (existing) return existing.properties.sheetId;

  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }]
    }
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

async function clearTab(sheets, spreadsheetId, tabName) {
  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${tabName}'`
  });
}

/**
 * Apply a checkbox data-validation to column A (rows 2..N).
 */
async function applyCheckboxes(sheets, spreadsheetId, sheetId, rowCount) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          setDataValidation: {
            range: {
              sheetId,
              startRowIndex: 1,           // row 2 (0-indexed)
              endRowIndex: 1 + rowCount,
              startColumnIndex: 0,        // cols A (Supprimer) + B (Envoyé)
              endColumnIndex: 2
            },
            rule: {
              condition: { type: 'BOOLEAN' },
              strict: true,
              showCustomUi: true
            }
          }
        },
        {
          // Freeze header row + bold it
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1
            },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 }
              }
            },
            fields: 'userEnteredFormat(textFormat,backgroundColor)'
          }
        },
        {
          updateSheetProperties: {
            properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
            fields: 'gridProperties.frozenRowCount'
          }
        }
      ]
    }
  });
}

async function main() {
  const { profile } = parseArgs();
  if (!profile) {
    console.error('Usage: node scripts/export_outreach_sheet.js --profile <name>');
    process.exit(1);
  }

  console.log(`📤 Export outreach → Google Sheet (profile: ${profile})`);

  const db = new Database(DB_PATH, { readonly: true });
  const accountId = getAccountId(db, profile);
  const leads = getPendingLeads(db, accountId);
  db.close();

  console.log(`   📊 ${leads.length} pending lead(s) for ${profile}`);

  if (leads.length === 0) {
    console.log('   ℹ️  Nothing to export.');
    return;
  }

  const sheets = await getSheetsClient(profile);
  const spreadsheetId = getSheetId(profile);
  const sheetId = await ensureTab(sheets, spreadsheetId, TAB_NAME);

  await clearTab(sheets, spreadsheetId, TAB_NAME);

  const header = ['Supprimer', 'Envoyé', 'Profil (web)', 'Message', 'Username', 'App (iOS)', 'Prénom', 'Source', 'Ajouté le'];
  const rows = leads.map(l => {
    const profileUrl = l.profile_url || `https://www.instagram.com/${l.username}/`;
    const appUrl = `instagram://user?username=${l.username}`;
    return [
      false,                              // A: checkbox supprimer
      false,                              // B: checkbox envoyé
      profileUrl,                         // C: profil web
      l.prepared_message || '',           // D: message
      l.username,                         // E: username
      appUrl,                             // F: app deeplink
      l.first_name || '',                 // G: prénom
      l.source || '',                     // H: source
      (l.created_at || '').slice(0, 16)   // I: date
    ];
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${TAB_NAME}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header, ...rows] }
  });

  await applyCheckboxes(sheets, spreadsheetId, sheetId, rows.length);

  console.log(`   ✅ ${rows.length} rows written to tab "${TAB_NAME}"`);
  console.log(`   🔗 https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}

main().catch(err => {
  console.error('❌ Export error:', err.message);
  process.exit(1);
});
