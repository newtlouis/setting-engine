#!/usr/bin/env node

/**
 * Unified Collection Script
 * 
 * Runs the complete collection pipeline in one command:
 * 1. Scrape Instagram posts and comments
 * 2. Save comments to SQLite database
 * 
 * Usage:
 *   npm run collect -- -t fitness -p competitor1 --max-posts 10
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
    if (process.env.IG_PROFILE) {
        console.log(`   (Profile: ${process.env.IG_PROFILE})`);
    }
    console.log('─'.repeat(60));
    
    const proc = spawn(command, args, {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env } // Explicitly pass env
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
    .option('--no-save', 'Skip saving to database')
    
    // Multi-account support
    .option('--profile <name>', 'Browser profile name (creates separate session data)')

    .parse();

  const options = program.opts();
  
  // Set profile env var if provided
  if (options.profile) {
      process.env.IG_PROFILE = options.profile;
      console.log(`👤 Using Browser Profile: ${options.profile}`);
  }
  
  console.log('\n🚀 Instagram Lead Collection Pipeline');
  console.log('=====================================\n');
  
  // Determine what steps to run
  const steps = {
    scrape: options.scrape !== false,
    save: options.save !== false
  };
  
  console.log('📋 Pipeline steps:');
  console.log(`   1. Scrape Instagram:  ${steps.scrape ? '✅' : '⏭️  SKIP'}`);
  console.log(`   2. Save to database:  ${steps.save ? '✅' : '⏭️  SKIP'}`);
  
  const startTime = Date.now();
  
  try {
    // Step 1: Scrape comments
    if (steps.scrape) {
      // Validate that we have hashtags or profiles
      if (!options.hashtags?.length && !options.profiles?.length) {
        console.error('\n❌ Error: You must provide --hashtags or --profiles for scraping');
        console.error('   Example: npm run collect -- -t fitness motivation --max-posts 10');
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
