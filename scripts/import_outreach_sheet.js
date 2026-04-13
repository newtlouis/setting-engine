#!/usr/bin/env node
/**
 * Import Manually-Sent Outreach from Google Sheet
 *
 * Reads the "Outreach Manuel" tab of the profile's Google Sheet and for
 * each row whose checkbox is ticked AND whose outreach_queue entry is
 * still 'pending', marks the lead as sent in the DB — mirroring exactly
 * what send_queued.js does on a successful send:
 *   1. outreach_queue.markQueuedLeadSent
 *   2. fullUpsertLead(status='contacted', funnel_step=1)
 *   3. addMessage(role='assistant', text=prepared_message, type=source)
 *
 * Idempotent: already-sent rows are skipped, so running this multiple
 * times per day only picks up newly-ticked rows.
 *
 * Usage:
 *   node scripts/import_outreach_sheet.js --profile katessence
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, 'agents', 'dmresponder', '.env') });

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

function isTrue(v) {
  return v === true || v === 'TRUE' || v === 'true';
}

async function readCheckedRows(sheets, spreadsheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${TAB_NAME}'!A2:I`,
    valueRenderOption: 'UNFORMATTED_VALUE'
  });
  const rows = res.data.values || [];
  return rows
    .map((r, idx) => ({
      toDelete: isTrue(r[0]),     // A
      sent: isTrue(r[1]),         // B
      profile_url: r[2],          // C
      message: r[3] || '',        // D
      username: r[4],             // E
      first_name: r[6] || null,   // G
      // F (app url) and H (source) not needed for import
      rowIndex: idx + 1           // 0-based index in sheet (row 2 → 1)
    }))
    .filter(r => r.username && (r.toDelete || r.sent));
}

async function getTabSheetId(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const tab = meta.data.sheets.find(s => s.properties.title === tabName);
  if (!tab) throw new Error(`Tab "${tabName}" not found`);
  return tab.properties.sheetId;
}

async function deleteRowsFromSheet(sheets, spreadsheetId, sheetId, rowIndices) {
  if (rowIndices.length === 0) return;
  // Delete from bottom to top to preserve remaining indices
  const sorted = [...rowIndices].sort((a, b) => b - a);
  const requests = sorted.map(idx => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: idx,
        endIndex: idx + 1
      }
    }
  }));
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: { requests }
  });
}

async function main() {
  const { profile } = parseArgs();
  if (!profile) {
    console.error('Usage: node scripts/import_outreach_sheet.js --profile <name>');
    process.exit(1);
  }

  console.log(`📥 Import outreach ← Google Sheet (profile: ${profile})`);

  const sheets = await getSheetsClient(profile);
  const spreadsheetId = getSheetId(profile);

  const checkedRows = await readCheckedRows(sheets, spreadsheetId);
  const sentRows = checkedRows.filter(r => r.sent && !r.toDelete);
  const deleteRows = checkedRows.filter(r => r.toDelete);
  console.log(`   🔎 ${sentRows.length} "Envoyé" + ${deleteRows.length} "Supprimer" ticked`);

  if (checkedRows.length === 0) {
    console.log('   ℹ️  Nothing to import.');
    return;
  }

  // Lazy-load DB layer (uses dmresponder env via container)
  const { getContainer } = await import('../shared/container.js');
  const { fullUpsertLead, addMessage } = await import('../agents/dmresponder/src/db_integration.js');

  const container = await getContainer();
  const outreachQueue = container.repositories.outreachQueue;
  const account = await container.repositories.account.getOrCreate(profile);
  const accountId = account.id;

  let imported = 0;
  let alreadySent = 0;
  let notFound = 0;
  let deleted = 0;
  let alreadyDeleted = 0;

  // ---- First pass: "Supprimer" (takes priority) ----
  for (const row of deleteRows) {
    const username = row.username;
    const entry = await outreachQueue.findByUsername(username);
    if (!entry) {
      console.log(`   ⚠️  @${username}: not in queue — skipping delete`);
      notFound++;
      continue;
    }
    if (entry.status === 'failed' && entry.error === 'manually_rejected') {
      alreadyDeleted++;
      continue;
    }
    if (entry.accountId && entry.accountId !== accountId) {
      console.log(`   ⚠️  @${username}: belongs to another account — skipping`);
      continue;
    }
    try {
      await outreachQueue.markFailed(username, 'manually_rejected');
      console.log(`   🗑️  @${username} → removed (manually rejected)`);
      deleted++;
    } catch (err) {
      console.error(`   ❌ @${username}: ${err.message}`);
    }
  }

  // ---- Second pass: "Envoyé" ----
  for (const row of sentRows) {
    const username = row.username;
    const entry = await outreachQueue.findByUsername(username);

    if (!entry) {
      console.log(`   ⚠️  @${username}: not found in outreach_queue — skipping`);
      notFound++;
      continue;
    }

    if (entry.status === 'sent') {
      alreadySent++;
      continue; // idempotent: skip silently
    }

    if (entry.accountId && entry.accountId !== accountId) {
      console.log(`   ⚠️  @${username}: belongs to another account (${entry.accountId}) — skipping`);
      continue;
    }

    const messageText = entry.preparedMessage || row.message;
    const sourceType = entry.source || row.source || null;

    try {
      await outreachQueue.markSent(username);
      await fullUpsertLead(username, accountId, {
        status: 'contacted',
        dm_url: entry.dmUrl || null,
        funnel_step: 1,
        notes: 'Sent manually from phone'
      });
      await addMessage(username, 'assistant', messageText, sourceType, accountId);
      console.log(`   ✅ @${username} → marked as sent`);
      imported++;
    } catch (err) {
      console.error(`   ❌ @${username}: ${err.message}`);
    }
  }

  // ---- Remove processed rows from the sheet ----
  // Any ticked row (Envoyé or Supprimer) is removed from the tab so the user
  // only ever sees what's left to send.
  const rowsToRemove = checkedRows.map(r => r.rowIndex);
  if (rowsToRemove.length > 0) {
    const sheetId = await getTabSheetId(sheets, spreadsheetId, TAB_NAME);
    await deleteRowsFromSheet(sheets, spreadsheetId, sheetId, rowsToRemove);
    console.log(`   🧹 Removed ${rowsToRemove.length} processed row(s) from the sheet`);
  }

  console.log('\n========================================');
  console.log(`   Imported:         ${imported}`);
  console.log(`   Already sent:     ${alreadySent}`);
  console.log(`   Deleted:          ${deleted}`);
  console.log(`   Already deleted:  ${alreadyDeleted}`);
  console.log(`   Not in queue:     ${notFound}`);
  console.log('========================================');
}

main().catch(err => {
  console.error('❌ Import error:', err.message);
  process.exit(1);
});
