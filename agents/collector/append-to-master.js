#!/usr/bin/env node

/**
 * Append scraped comments to permanent master CSV
 * 
 * IMPROVED: Now keeps ALL comments per user (not just the first one)
 * This allows accurate engagement scoring based on comment frequency
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
    
    try {
      const masterData = await fs.readFile(masterFile, 'utf-8');
      existingComments = parse(masterData, {
        columns: true,
        skip_empty_lines: true
      });
      
      console.log(`📚 Master file has ${existingComments.length} existing records`);
    } catch {
      console.log('📝 Creating new master file...');
    }

    // Create a Set of existing comment signatures to detect TRUE duplicates
    // A duplicate = same username + same comment text + same post URL
    const existingSignatures = new Set();
    existingComments.forEach(comment => {
      const signature = `${comment.username}|${comment.post_url}|${comment.comment_text?.substring(0, 50)}`;
      existingSignatures.add(signature);
    });

    // Filter out TRUE duplicates only (same person, same comment, same post)
    // But KEEP multiple comments from the same person on different posts or different comments
    const uniqueNewComments = newComments.filter(comment => {
      const signature = `${comment.username}|${comment.post_url}|${comment.comment_text?.substring(0, 50)}`;
      return !existingSignatures.has(signature);
    });

    const duplicatesSkipped = newComments.length - uniqueNewComments.length;

    if (uniqueNewComments.length === 0) {
      console.log('ℹ️  All comments already exist in master (exact duplicates)');
      return;
    }

    // Append new unique comments
    const allComments = [...existingComments, ...uniqueNewComments];

    // Get all column headers from both existing and new comments
    const allColumns = new Set([
      'username',
      'full_name', 
      'comment_text',
      'comment_date',
      'post_url',
      'source',
      'profile_url',
      'is_spam',
      'spam_reason',
      'followers_count',
      'is_verified',
      'is_business'
    ]);

    // Write back to master with all columns
    const csvOutput = stringify(allComments, {
      header: true,
      columns: Array.from(allColumns)
    });

    await fs.writeFile(masterFile, csvOutput);

    // Calculate stats
    const uniqueUsers = new Set(allComments.map(c => c.username));
    const totalCommentsByUser = {};
    allComments.forEach(c => {
      totalCommentsByUser[c.username] = (totalCommentsByUser[c.username] || 0) + 1;
    });
    const multiCommenters = Object.values(totalCommentsByUser).filter(count => count > 1).length;

    console.log(`\n✅ Success!`);
    console.log(`   Added ${uniqueNewComments.length} new comments`);
    console.log(`   Skipped ${duplicatesSkipped} exact duplicates`);
    console.log(`   Master now contains ${allComments.length} total comments`);
    console.log(`   From ${uniqueUsers.size} unique prospects`);
    console.log(`   ${multiCommenters} prospects have multiple comments (high engagement)`);
    console.log(`   Saved to: ${masterFile}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
appendToMaster();
