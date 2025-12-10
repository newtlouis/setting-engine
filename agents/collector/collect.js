#!/usr/bin/env node

/**
 * Unified Collection Script
 * 
 * Runs the complete collection pipeline in one command:
 * 1. Scrape Instagram posts and comments
 * 2. Save comments to SQLite database
 * 3. (Optional) Scrape profile data for new leads
 * 4. Build Excel report
 * 5. Open the Excel file (optional)
 * 
 * Usage:
 *   npm run collect -- -t fitness -p competitor1 --max-posts 10
 *   npm run collect -- -t fitness --scrape-profiles
 *   npm run collect -- --only-save-build
 *   npm run collect -- --only-profiles  (just scrape profiles for existing leads)
 */

import { spawn } from 'child_process';
import { program } from 'commander';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '.env') });

// Helper to run a command and stream output
function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`▶ Running: ${command} ${args.join(' ')}`);
    console.log('─'.repeat(60));
    
    const proc = spawn(command, args, {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

// Helper to open file (cross-platform)
function openFile(filePath) {
  const platform = process.platform;
  let command;
  
  if (platform === 'darwin') {
    command = 'open';
  } else if (platform === 'win32') {
    command = 'start';
  } else {
    command = 'xdg-open';
  }
  
  return spawn(command, [filePath], { 
    detached: true, 
    stdio: 'ignore',
    shell: true 
  }).unref();
}

async function main() {
  program
    .name('collect')
    .description('Complete Instagram lead collection pipeline')
    .version('1.0.0')
    
    // Scraping options
    .option('-t, --hashtags <tags...>', 'Hashtags to scrape (space-separated)')
    .option('-p, --profiles <urls...>', 'Competitor profiles to scrape (space-separated)')
    .option('--max-posts <number>', 'Maximum posts per source', '10')
    .option('--max-comments <number>', 'Maximum comments per post', '50')
    
    // Profile scraping
    .option('--scrape-profiles', 'Scrape profile data (followers, bio) for new leads')
    .option('--max-profile-age <hours>', 'Max age in hours before re-scraping profiles', '168')
    
    // Pipeline control options
    .option('--no-scrape', 'Skip scraping (only process existing data)')
    .option('--no-save', 'Skip saving to database')
    .option('--no-build', 'Skip building Excel report')
    .option('--no-open', 'Don\'t open Excel file after completion')
    
    // Shortcut options
    .option('--only-save-build', 'Only run save + build (skip scraping)')
    .option('--only-build', 'Only build Excel from existing database')
    .option('--only-profiles', 'Only scrape profiles for leads missing profile data')
    
    .parse();

  const options = program.opts();
  
  console.log('\n🚀 Instagram Lead Collection Pipeline');
  console.log('=====================================\n');
  
  // Handle shortcut options
  if (options.onlyBuild) {
    options.scrape = false;
    options.save = false;
    options.scrapeProfiles = false;
  }
  if (options.onlySaveBuild) {
    options.scrape = false;
  }
  if (options.onlyProfiles) {
    options.scrape = false;
    options.save = false;
    options.scrapeProfiles = true;
  }
  
  // Determine what steps to run
  const steps = {
    scrape: options.scrape !== false,
    save: options.save !== false,
    profiles: options.scrapeProfiles || options.onlyProfiles,
    build: options.build !== false,
    open: options.open !== false
  };
  
  console.log('📋 Pipeline steps:');
  console.log(`   1. Scrape Instagram:  ${steps.scrape ? '✅' : '⏭️  SKIP'}`);
  console.log(`   2. Save to database:  ${steps.save ? '✅' : '⏭️  SKIP'}`);
  console.log(`   3. Scrape profiles:   ${steps.profiles ? '✅' : '⏭️  SKIP'}`);
  console.log(`   4. Build Excel:       ${steps.build ? '✅' : '⏭️  SKIP'}`);
  console.log(`   5. Open Excel:        ${steps.open ? '✅' : '⏭️  SKIP'}`);
  
  const startTime = Date.now();
  
  try {
    // Step 1: Scrape comments
    if (steps.scrape) {
      // Validate that we have hashtags or profiles
      if (!options.hashtags?.length && !options.profiles?.length) {
        console.error('\n❌ Error: You must provide --hashtags or --profiles for scraping');
        console.error('   Example: npm run collect -- -t fitness motivation --max-posts 10');
        console.error('   Or use --only-save-build to skip scraping');
        process.exit(1);
      }
      
      const scrapeArgs = ['run', 'scrape-core', '--'];
      
      if (options.hashtags?.length) {
        scrapeArgs.push('-t', ...options.hashtags);
      }
      if (options.profiles?.length) {
        scrapeArgs.push('-p', ...options.profiles);
      }
      scrapeArgs.push('--max-posts', options.maxPosts);
      scrapeArgs.push('--max-comments', options.maxComments);
      
      await runCommand('npm', scrapeArgs);
    }
    
    // Step 2: Save to database
    if (steps.save) {
      await runCommand('npm', ['run', 'save-comments']);
    }
    
    // Step 3: Scrape profiles (if enabled)
    if (steps.profiles) {
      console.log(`\n${'─'.repeat(60)}`);
      console.log('▶ Scraping profile data for leads...');
      console.log('─'.repeat(60));
      
      // Dynamic import to avoid loading browser when not needed
      const { scrapeProfilesForLeads } = await import('./scrape-profiles.js');
      await scrapeProfilesForLeads({
        maxAge: parseInt(options.maxProfileAge, 10) || 168
      });
    }
    
    // DASHBOARD NOTICE
    console.log(`\n${'═'.repeat(60)}`);
    console.log('✅ Pipeline completed!');
    console.log('   Data saved to SQLite database.');
    console.log('   👉 Run "npm run ui" to view your leads in the Dashboard.');
    console.log('═'.repeat(60));
    
  } catch (error) {
    console.error(`\n❌ Pipeline failed: ${error.message}`);
    process.exit(1);
  }
}

main();
