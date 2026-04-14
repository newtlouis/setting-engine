/**
 * Data Backup Script
 *
 * Copies critical data files to a timestamped backup directory.
 * Supports automatic upload to Google Drive via rclone.
 *
 * Usage:
 *   node scripts/backup.js                    # Local backup only
 *   node scripts/backup.js --upload           # Local + upload to Google Drive
 *   node scripts/backup.js --keep 14          # Keep 14 backups instead of 7
 *
 * Setup rclone:
 *   1. Install rclone: https://rclone.org/install/
 *   2. Configure Google Drive: rclone config (create remote named "gdrive")
 *   3. Test: rclone lsd gdrive:
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..'); // agents/collector

// Configuration
const CONFIG = {
  // Critical files to backup
  filesToBackup: [
    'permanent-data/leads.db',
    'permanent-data/scraped_posts.json',
    '.env'
  ],
  // Default backup location
  localBackupDir: path.resolve(ROOT_DIR, '../../backups'),
  // Number of backups to keep (rotation)
  keepBackups: 3,
  // rclone remote name (configure with: rclone config)
  rcloneRemote: 'gdrive',
  // Remote folder path on Google Drive
  remotePath: 'instagram-lead-engine-backups'
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    upload: false,
    keep: CONFIG.keepBackups
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--upload') {
      options.upload = true;
    } else if (args[i] === '--keep' && args[i + 1]) {
      options.keep = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return options;
}

// Check if rclone is installed and configured
function checkRclone() {
  try {
    execSync('rclone version', { stdio: 'pipe' });
    // Check if remote exists
    const remotes = execSync('rclone listremotes', { encoding: 'utf-8' });
    if (!remotes.includes(`${CONFIG.rcloneRemote}:`)) {
      console.error(`\n❌ rclone remote "${CONFIG.rcloneRemote}" not found.`);
      console.error('   Run: rclone config');
      console.error('   Create a new remote named "gdrive" for Google Drive.\n');
      return false;
    }
    return true;
  } catch {
    console.error('\n❌ rclone is not installed.');
    console.error('   Install it from: https://rclone.org/install/\n');
    return false;
  }
}

// Upload backup to Google Drive using rclone
function uploadToGoogleDrive(backupDir, backupName) {
  console.log('\n☁️  Uploading to Google Drive...');

  try {
    const remoteDest = `${CONFIG.rcloneRemote}:${CONFIG.remotePath}/${backupName}`;
    execSync(`rclone copy "${backupDir}" "${remoteDest}" --progress`, {
      stdio: 'inherit'
    });
    console.log(`   ✅ Uploaded to: ${CONFIG.remotePath}/${backupName}`);
    return true;
  } catch (err) {
    console.error(`   ❌ Upload failed: ${err.message}`);
    return false;
  }
}

// Delete old backups (rotation)
function rotateBackups(backupBaseDir, keepCount) {
  console.log(`\n🔄 Rotating backups (keeping last ${keepCount})...`);

  if (!fs.existsSync(backupBaseDir)) {
    return;
  }

  // Get all backup directories
  const backups = fs.readdirSync(backupBaseDir)
    .filter(name => name.startsWith('backup-'))
    .map(name => ({
      name,
      path: path.join(backupBaseDir, name),
      time: fs.statSync(path.join(backupBaseDir, name)).mtime.getTime()
    }))
    .sort((a, b) => b.time - a.time); // Newest first

  // Delete old backups
  const toDelete = backups.slice(keepCount);

  if (toDelete.length === 0) {
    console.log('   No old backups to delete.');
    return;
  }

  for (const backup of toDelete) {
    try {
      fs.rmSync(backup.path, { recursive: true });
      console.log(`   🗑️  Deleted: ${backup.name}`);
    } catch (err) {
      console.error(`   ❌ Failed to delete ${backup.name}: ${err.message}`);
    }
  }
}

// Rotate remote backups on Google Drive
function rotateRemoteBackups(keepCount) {
  console.log(`\n🔄 Rotating remote backups (keeping last ${keepCount})...`);

  try {
    // List remote directories
    const output = execSync(
      `rclone lsf "${CONFIG.rcloneRemote}:${CONFIG.remotePath}" --dirs-only`,
      { encoding: 'utf-8' }
    );

    const remoteBackups = output
      .trim()
      .split('\n')
      .filter(name => name.startsWith('backup-'))
      .map(name => name.replace(/\/$/, '')) // Remove trailing slash
      .sort()
      .reverse(); // Newest first (ISO timestamp sorts correctly)

    const toDelete = remoteBackups.slice(keepCount);

    if (toDelete.length === 0) {
      console.log('   No old remote backups to delete.');
      return;
    }

    for (const backup of toDelete) {
      try {
        execSync(
          `rclone purge "${CONFIG.rcloneRemote}:${CONFIG.remotePath}/${backup}"`,
          { stdio: 'pipe' }
        );
        console.log(`   🗑️  Deleted remote: ${backup}`);
      } catch (err) {
        console.error(`   ❌ Failed to delete remote ${backup}`);
      }
    }
  } catch (err) {
    // Folder might not exist yet
    if (!err.message.includes('directory not found')) {
      console.error(`   ⚠️  Could not rotate remote backups: ${err.message}`);
    }
  }
}

async function backup() {
  const options = parseArgs();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupName = `backup-${timestamp}`;
  const destDir = path.join(CONFIG.localBackupDir, backupName);

  console.log('📦 Starting data backup...');
  console.log(`   Destination: ${destDir}`);
  console.log(`   Keep: ${options.keep} backups`);
  console.log(`   Upload to Google Drive: ${options.upload ? 'Yes' : 'No'}`);

  // Check rclone if upload requested
  if (options.upload && !checkRclone()) {
    process.exit(1);
  }

  // Ensure destination exists
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  let successCount = 0;

  for (const file of CONFIG.filesToBackup) {
    const sourcePath = path.join(ROOT_DIR, file);
    const destPath = path.join(destDir, path.basename(file));

    if (fs.existsSync(sourcePath)) {
      try {
        // Check if it's a DB file, copy WAL/SHM too if they exist
        if (file.endsWith('.db')) {
          // Copy main db
          fs.copyFileSync(sourcePath, destPath);

          // Try copy WAL
          if (fs.existsSync(sourcePath + '-wal')) {
            fs.copyFileSync(sourcePath + '-wal', destPath + '-wal');
          }
          // Try copy SHM
          if (fs.existsSync(sourcePath + '-shm')) {
            fs.copyFileSync(sourcePath + '-shm', destPath + '-shm');
          }
        } else {
          fs.copyFileSync(sourcePath, destPath);
        }
        console.log(`   ✅ Copied: ${file}`);
        successCount++;
      } catch (err) {
        console.error(`   ❌ Failed to copy ${file}: ${err.message}`);
      }
    } else {
      console.warn(`   ⚠️  File not found (skipped): ${file}`);
    }
  }

  if (successCount === 0) {
    console.error('\n❌ No files were backed up.');
    process.exit(1);
  }

  console.log(`\n🎉 Local backup complete! (${successCount} files)`);

  // Upload to Google Drive if requested
  if (options.upload) {
    uploadToGoogleDrive(destDir, backupName);
    rotateRemoteBackups(options.keep);
  }

  // Rotate local backups
  rotateBackups(CONFIG.localBackupDir, options.keep);

  console.log('\n✅ All done!');
}

backup().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
