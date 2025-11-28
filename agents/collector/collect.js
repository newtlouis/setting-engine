#!/usr/bin/env node

/**
 * Unified Collection Script
 * 
 * Runs the complete collection pipeline in one command:
 * 1. Scrape Instagram posts and comments
 * 2. Save comments to master database
 * 3. Build Excel report
 * 4. Open the Excel file (optional)
 * 
 * Usage:
 *   npm run collect -- -t fitness -p competitor1 --max-posts 10
 *   npm run collect -- -t fitness --no-open
 *   npm run collect -- --only-save-build  (skip scraping, just process existing data)
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
    
    // Pipeline control options
    .option('--no-scrape', 'Skip scraping (only process existing data)')
    .option('--no-save', 'Skip saving to master database')
    .option('--no-build', 'Skip building Excel report')
    .option('--no-open', 'Don\'t open Excel file after completion')
    
    // Shortcut options
    .option('--only-save-build', 'Only run save + build (skip scraping)')
    .option('--only-build', 'Only build Excel from existing master data')
    
    .parse();

  const options = program.opts();
  
  console.log('\n🚀 Instagram Lead Collection Pipeline');
  console.log('=====================================\n');
  
  // Handle shortcut options
  if (options.onlyBuild) {
    options.scrape = false;
    options.save = false;
  }
  if (options.onlySaveBuild) {
    options.scrape = false;
  }
  
  // Determine what steps to run
  const steps = {
    scrape: options.scrape !== false,
    save: options.save !== false,
    build: options.build !== false,
    open: options.open !== false
  };
  
  console.log('📋 Pipeline steps:');
  console.log(`   1. Scrape Instagram: ${steps.scrape ? '✅' : '⏭️  SKIP'}`);
  console.log(`   2. Save to master:   ${steps.save ? '✅' : '⏭️  SKIP'}`);
  console.log(`   3. Build Excel:      ${steps.build ? '✅' : '⏭️  SKIP'}`);
  console.log(`   4. Open Excel:       ${steps.open ? '✅' : '⏭️  SKIP'}`);
  
  const startTime = Date.now();
  
  try {
    // Step 1: Scrape
    if (steps.scrape) {
      // Validate that we have hashtags or profiles
      if (!options.hashtags?.length && !options.profiles?.length) {
        console.error('\n❌ Error: You must provide --hashtags or --profiles for scraping');
        console.error('   Example: npm run collect -- -t fitness motivation --max-posts 10');
        console.error('   Or use --only-save-build to skip scraping');
        process.exit(1);
      }
      
      const scrapeArgs = ['run', 'scrape', '--'];
      
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
    
    // Step 2: Save to master
    if (steps.save) {
      await runCommand('npm', ['run', 'save-comments']);
    }
    
    // Step 3: Build Excel
    if (steps.build) {
      await runCommand('npm', ['run', 'build-final-db']);
    }
    
    // Step 4: Open Excel
    if (steps.open && steps.build) {
      const excelPath = join(__dirname, 'output', 'instagram_final_database.xlsx');
      
      try {
        await fs.access(excelPath);
        console.log(`\n${'─'.repeat(60)}`);
        console.log('▶ Opening Excel file...');
        console.log('─'.repeat(60));
        openFile(excelPath);
        console.log(`   📂 Opened: ${excelPath}`);
      } catch {
        console.log('\n⚠️  Excel file not found, skipping open');
      }
    }
    
    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n${'═'.repeat(60)}`);
    console.log('✅ Pipeline completed successfully!');
    console.log(`   Total time: ${duration}s`);
    console.log('═'.repeat(60));
    
  } catch (error) {
    console.error(`\n❌ Pipeline failed: ${error.message}`);
    process.exit(1);
  }
}

main();
