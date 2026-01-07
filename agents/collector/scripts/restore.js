/**
 * Data Restore Script
 *
 * Restores the latest backup from Google Drive or local backups directory.
 * safely overwrites the current database with the backup.
 *
 * Usage:
 *   node scripts/restore.js                    # Interactive restore (local)
 *   node scripts/restore.js --remote           # Interactive restore from Google Drive
 *   node scripts/restore.js --latest           # Automatically restore latest local backup
 *   node scripts/restore.js --remote --latest  # Automatically restore latest remote backup
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { createInterface } from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..'); // agents/collector

// Configuration (Must match backup.js)
const CONFIG = {
  localBackupDir: path.resolve(ROOT_DIR, '../../backups'),
  rcloneRemote: 'gdrive',
  remotePath: 'instagram-lead-engine-backups',
  restoreTargets: {
    'leads.db': 'permanent-data/leads.db',
    'scraped_posts.json': 'permanent-data/scraped_posts.json',
    '.env': '.env'
  }
};

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (query) => new Promise((resolve) => rl.question(query, resolve));

// Parse args
const args = process.argv.slice(2);
const options = {
  remote: args.includes('--remote'),
  latest: args.includes('--latest')
};

async function getLocalBackups() {
  if (!fs.existsSync(CONFIG.localBackupDir)) return [];
  
  return fs.readdirSync(CONFIG.localBackupDir)
    .filter(name => name.startsWith('backup-'))
    .map(name => ({
      name,
      path: path.join(CONFIG.localBackupDir, name),
      time: fs.statSync(path.join(CONFIG.localBackupDir, name)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time);
}

function getRemoteBackups() {
  try {
    const output = execSync(
      `rclone lsf "${CONFIG.rcloneRemote}:${CONFIG.remotePath}" --dirs-only`,
      { encoding: 'utf-8' }
    );
    
    return output
      .trim()
      .split('\n')
      .filter(name => name.startsWith('backup-'))
      .map(name => name.replace(/\/$/, '')) // Remove trailing slash
      .sort()
      .reverse() // Newest first
      .map(name => ({
        name,
        path: `${CONFIG.rcloneRemote}:${CONFIG.remotePath}/${name}`, // Remote path
        isRemote: true
      }));
  } catch (err) {
    console.error(`Error listing remote backups: ${err.message}`);
    return [];
  }
}

async function restoreFrom(backup) {
  console.log(`\n📦 Restoring from: ${backup.name}`);
  console.log('   ⚠️  WARNING: This will overwrite current data!');
  console.log('   ⚠️  IMPORTANT: Ensure the Dashboard and all agents are CLOSED before proceeding.');
  
  if (!options.latest) {
    const confirm = await question('   Are you sure? (y/N): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('   Cancelled.');
      return;
    }
  }

  // Ensure permament-data dir exists
  const permDataDir = path.join(ROOT_DIR, 'permanent-data');
  if (!fs.existsSync(permDataDir)) fs.mkdirSync(permDataDir, { recursive: true });

  // CRITICAL: If we are restoring a .db, we MUST delete current WAL/SHM files
  // otherwise SQLite might try to "recover" from the old WAL using the new DB.
  const dbPath = path.join(ROOT_DIR, CONFIG.restoreTargets['leads.db']);
  if (fs.existsSync(dbPath + '-wal')) {
    console.log('   🧹 Cleaning up existing WAL file...');
    fs.unlinkSync(dbPath + '-wal');
  }
  if (fs.existsSync(dbPath + '-shm')) {
    console.log('   🧹 Cleaning up existing SHM file...');
    fs.unlinkSync(dbPath + '-shm');
  }

  for (const [filename, targetRelPath] of Object.entries(CONFIG.restoreTargets)) {
    const targetPath = path.join(ROOT_DIR, targetRelPath);
    
    try {
      if (backup.isRemote) {
        // Rclone copy individual file
        console.log(`   ⬇️  Downloading ${filename}...`);
        execSync(
          `rclone copy "${backup.path}/${filename}" "${path.dirname(targetPath)}"`,
          { stdio: 'inherit' }
        );

        // For DB, try to download WAL/SHM if they exist in backup
        if (filename.endsWith('.db')) {
           try {
             execSync(`rclone copy "${backup.path}/${filename}-wal" "${path.dirname(targetPath)}"`, { stdio: 'ignore' });
             console.log(`   ✅ Restored: ${filename}-wal`);
           } catch(e) {}
           try {
             execSync(`rclone copy "${backup.path}/${filename}-shm" "${path.dirname(targetPath)}"`, { stdio: 'ignore' });
             console.log(`   ✅ Restored: ${filename}-shm`);
           } catch(e) {}
        }
      } else {
        // Local copy
        const sourcePath = path.join(backup.path, filename);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          
          // Restore WAL/SHM if relevant
          if (filename.endsWith('.db')) {
             if (fs.existsSync(sourcePath + '-wal')) {
               fs.copyFileSync(sourcePath + '-wal', targetPath + '-wal');
               console.log(`   ✅ Restored: ${filename}-wal`);
             }
             if (fs.existsSync(sourcePath + '-shm')) {
               fs.copyFileSync(sourcePath + '-shm', targetPath + '-shm');
               console.log(`   ✅ Restored: ${filename}-shm`);
             }
          }
        } else {
          console.log(`   ⚠️  File not found in backup: ${filename}`);
          continue;
        }
      }
      console.log(`   ✅ Restored: ${filename}`);
    } catch (err) {
      console.error(`   ❌ Failed to restore ${filename}: ${err.message}`);
    }
  }
  
  console.log('\n🎉 Restore complete!');
}

async function main() {
  console.log('\n========================================');
  console.log('   DATABASE RESTORE TOOL');
  console.log('========================================\n');

  let backups = [];
  
  if (options.remote) {
    console.log('☁️  Fetching remote backups from Google Drive...');
    backups = getRemoteBackups();
  } else {
    console.log('📂 Checking local backups...');
    backups = await getLocalBackups();
  }

  if (backups.length === 0) {
    console.log(`❌ No ${options.remote ? 'remote' : 'local'} backups found.`);
    if (!options.remote) console.log('   Try checking remote backups: node scripts/restore.js --remote');
    process.exit(1);
  }

  if (options.latest) {
    await restoreFrom(backups[0]);
  } else {
    console.log('\nAvailable Backups:');
    backups.slice(0, 10).forEach((b, i) => {
      console.log(`   ${i + 1}. ${b.name}`);
    });
    
    const choice = await question('\nSelect backup # (or 0 to cancel): ');
    const index = parseInt(choice, 10) - 1;
    
    if (index >= 0 && index < backups.length) {
      await restoreFrom(backups[index]);
    } else {
      console.log('Cancelled.');
    }
  }
  
  rl.close();
}

main().catch(console.error);
