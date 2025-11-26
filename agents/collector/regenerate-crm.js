#!/usr/bin/env node

/**
 * Regenerate Excel CRM from existing CSV files
 * 
 * This script reads comments.csv and posts.csv and generates a fresh Excel file
 */

import { ExcelCRM } from './src/excel_writer.js';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'csv-parse/sync';
import { join } from 'path';

const OUTPUT_DIR = process.env.OUTPUT_DIR || './output';

async function regenerateCRM() {
  console.log('🔄 Regenerating Excel CRM from CSV files...\n');
  
  // Read comments.csv
  const commentsPath = join(OUTPUT_DIR, 'comments.csv');
  if (!existsSync(commentsPath)) {
    console.error('❌ comments.csv not found!');
    process.exit(1);
  }
  
  const commentsCSV = readFileSync(commentsPath, 'utf-8');
  const comments = parse(commentsCSV, { columns: true, skip_empty_lines: true });
  
  console.log(`📥 Loaded ${comments.length} comments from comments.csv`);
  
  // Read posts.csv
  const postsPath = join(OUTPUT_DIR, 'posts.csv');
  const posts = [];
  
  if (existsSync(postsPath)) {
    const postsCSV = readFileSync(postsPath, 'utf-8');
    const parsedPosts = parse(postsCSV, { columns: true, skip_empty_lines: true });
    posts.push(...parsedPosts);
    console.log(`📥 Loaded ${posts.length} posts from posts.csv`);
  }
  
  // Transform comments to prospects with engagement data
  const transformedComments = comments.map(comment => ({
    post_url: comment.post_url,
    username: comment.username,
    profile_url: comment.profile_url,
    comment_text: comment.comment_text,
    comment_date: comment.comment_date,
    followers_estimate: comment.followers_estimate || 'Unknown',
    date_added: new Date().toISOString()
  }));
  
  console.log('\n📊 Generating Excel CRM...');
  
  // Create Excel CRM instance
  const crm = new ExcelCRM(OUTPUT_DIR);
  
  // Load or create workbook
  await crm.load();
  
  // Update with all comments (use the correct method!)
  const stats = await crm.updateWithComments(transformedComments, 'manual_regeneration');
  
  console.log(`\n   ✅ Added ${stats.new_prospects} new prospects`);
  console.log(`   ✅ Updated ${stats.updated_prospects} existing prospects`);
  console.log(`   ✅ Recorded ${stats.new_comments} new comments`);
  
  // Save
  const excelPath = await crm.save();
  
  console.log(`\n✅ Excel CRM regenerated successfully!`);
  console.log(`   File: ${excelPath}`);
  console.log(`   Total prospects: ${transformedComments.length}`);
  console.log(`   Posts tracked: ${posts.length}`);
  
  // Display sample prospects
  if (transformedComments.length > 0) {
    console.log('\n📋 Sample prospects:');
    transformedComments.slice(0, 5).forEach((c, i) => {
      console.log(`   ${i + 1}. @${c.username} - "${c.comment_text.substring(0, 50)}..."`);
    });
  }
  
  console.log('\n🚀 Done! Open the file with:');
  console.log('   ./open-crm.sh\n');
}

// Run
regenerateCRM().catch(error => {
  console.error('❌ Error:', error.message);
  process.exit(1);
});
