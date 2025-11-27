#!/usr/bin/env node

/**
 * Append scraped comments to permanent master CSV
 * This ensures all data is permanently saved and never lost
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function appendToMaster() {
  const outputDir = path.join(__dirname, 'output');
  const permanentDir = path.join(__dirname, 'permanent-data');
  const commentsFile = path.join(outputDir, 'comments.csv');
  const masterFile = path.join(permanentDir, 'master_comments.csv');

  try {
    // Ensure permanent directory exists
    await fs.mkdir(permanentDir, { recursive: true });

    // Check if comments.csv exists
    try {
      await fs.access(commentsFile);
    } catch {
      console.log('❌ No comments.csv found in output/ directory');
      console.log('   Run "npm run scrape" first to collect data');
      return;
    }

    // Read new comments
    const newCommentsData = await fs.readFile(commentsFile, 'utf-8');
    const newComments = parse(newCommentsData, {
      columns: true,
      skip_empty_lines: true
    });

    if (newComments.length === 0) {
      console.log('⚠️  comments.csv is empty, nothing to append');
      return;
    }

    console.log(`📋 Found ${newComments.length} comments to process`);

    // Read existing master (if exists)
    let existingComments = [];
    let existingUsernames = new Set();
    
    try {
      const masterData = await fs.readFile(masterFile, 'utf-8');
      existingComments = parse(masterData, {
        columns: true,
        skip_empty_lines: true
      });
      
      // Track existing usernames to avoid duplicates
      existingComments.forEach(comment => {
        existingUsernames.add(comment.username);
      });
      
      console.log(`📚 Master file has ${existingComments.length} existing records`);
    } catch {
      console.log('📝 Creating new master file...');
    }

    // Filter out duplicates
    const uniqueNewComments = newComments.filter(comment => 
      !existingUsernames.has(comment.username)
    );

    if (uniqueNewComments.length === 0) {
      console.log('ℹ️  All comments already exist in master (no new unique prospects)');
      return;
    }

    // Append new unique comments
    const allComments = [...existingComments, ...uniqueNewComments];

    // Write back to master
    const csvOutput = stringify(allComments, {
      header: true,
      columns: [
        'username',
        'full_name',
        'comment_text',
        'comment_date',
        'post_url',
        'source'
      ]
    });

    await fs.writeFile(masterFile, csvOutput);

    console.log(`\n✅ Success!`);
    console.log(`   Added ${uniqueNewComments.length} new unique prospects`);
    console.log(`   Master now contains ${allComments.length} total prospects`);
    console.log(`   Saved to: ${masterFile}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
appendToMaster();