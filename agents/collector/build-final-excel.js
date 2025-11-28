#!/usr/bin/env node

/**
 * Build final Excel database from master CSV
 * Creates a professional Excel file with multiple sheets and formatting
 * Now includes engagement scoring and comment tracking
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Calculate engagement score based on comment patterns
 * 
 * Enhanced algorithm considering:
 * - Frequency (number of comments)
 * - Recency (how recent are comments)
 * - Quality (comment length and content)
 * - Patterns (questions, emojis, keywords)
 */
function calculateEngagementScore(comments) {
  if (!comments || comments.length === 0) return { level: 'LOW', score: 0 };
  
  const now = new Date();
  let score = 0;
  
  // 1. FREQUENCY SCORE (0-10 points)
  // Multiple comments show consistent engagement
  score += Math.min(comments.length * 2, 10);
  
  // 2. RECENCY SCORE (0-15 points)
  // Recent activity is more valuable
  let recentScore = 0;
  for (const comment of comments) {
    const commentDate = new Date(comment.comment_date || 0);
    const daysAgo = (now - commentDate) / (1000 * 60 * 60 * 24);
    
    if (daysAgo < 7) recentScore += 5;       // Very recent: high value
    else if (daysAgo < 30) recentScore += 3; // Recent: medium value
    else if (daysAgo < 90) recentScore += 1; // Not too old
  }
  score += Math.min(recentScore, 15);
  
  // 3. QUALITY SCORE (0-10 points)
  // Longer, thoughtful comments indicate higher engagement
  let qualityScore = 0;
  let totalLength = 0;
  
  for (const comment of comments) {
    const text = comment.comment_text || '';
    totalLength += text.length;
    
    // Individual comment quality
    if (text.length > 100) qualityScore += 3;      // Detailed comment
    else if (text.length > 50) qualityScore += 2;  // Engaged comment
    else if (text.length > 20) qualityScore += 1;  // Basic comment
  }
  score += Math.min(qualityScore, 10);
  
  // 4. PATTERN SCORE (0-10 points)
  // Questions and emojis show emotional engagement
  let patternScore = 0;
  
  for (const comment of comments) {
    const text = comment.comment_text || '';
    
    // Questions indicate interest/intent
    if (text.includes('?')) patternScore += 2;
    
    // Emojis indicate emotional engagement
    if (/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]/u.test(text)) patternScore += 1;
    
    // Exclamation marks indicate excitement
    if (text.includes('!')) patternScore += 1;
    
    // @ mentions indicate conversation
    if (text.includes('@')) patternScore += 1;
  }
  score += Math.min(patternScore, 10);
  
  // 5. AVERAGE LENGTH BONUS (0-5 points)
  const avgLength = totalLength / comments.length;
  if (avgLength > 100) score += 5;      // Conversations
  else if (avgLength > 50) score += 3;  // Engaged
  else if (avgLength > 20) score += 1;  // Basic
  
  // CLASSIFICATION (adjusted thresholds for realistic distribution)
  // Total possible: 50 points
  let level;
  if (score >= 25) level = 'HIGH';        // Top tier: very engaged prospects
  else if (score >= 12) level = 'MEDIUM'; // Mid tier: moderately engaged
  else level = 'LOW';                     // Bottom tier: low engagement
  
  return { level, score };
}

async function buildFinalExcel() {
  const permanentDir = path.join(__dirname, 'permanent-data');
  const outputDir = path.join(__dirname, 'output');
  const masterFile = path.join(permanentDir, 'master_comments.csv');
  const outputFile = path.join(outputDir, 'instagram_final_database.xlsx');

  try {
    // Check if master file exists
    try {
      await fs.access(masterFile);
    } catch {
      console.log('❌ No master_comments.csv found');
      console.log('   Run "npm run save-comments" first to create the master file');
      return;
    }

    // Read master comments
    const masterData = await fs.readFile(masterFile, 'utf-8');
    const comments = parse(masterData, {
      columns: true,
      skip_empty_lines: true
    });

    if (comments.length === 0) {
      console.log('⚠️  Master file is empty');
      return;
    }

    console.log(`📊 Building Excel from ${comments.length} comments...`);

    // Filter out spam comments for engagement calculation
    const nonSpamComments = comments.filter(c => c.is_spam !== 'true' && c.is_spam !== true);
    const spamComments = comments.filter(c => c.is_spam === 'true' || c.is_spam === true);
    
    console.log(`   Non-spam comments: ${nonSpamComments.length}`);
    console.log(`   Spam comments filtered: ${spamComments.length}`);

    // Group comments by username to calculate engagement
    const userGroups = {};
    nonSpamComments.forEach(comment => {
      const username = comment.username;
      if (!userGroups[username]) {
        userGroups[username] = {
          username: username,
          full_name: comment.full_name || '',
          profile_url: comment.profile_url || '',
          comments: [],
          sources: new Set(),
          firstSeen: comment.comment_date,
          lastSeen: comment.comment_date,
          qualityScores: []
        };
      }
      userGroups[username].comments.push(comment);
      userGroups[username].sources.add(comment.source);
      
      // Track quality scores
      if (comment.quality_score) {
        userGroups[username].qualityScores.push(parseInt(comment.quality_score, 10));
      }
      
      // Update date range
      if (comment.comment_date < userGroups[username].firstSeen) {
        userGroups[username].firstSeen = comment.comment_date;
      }
      if (comment.comment_date > userGroups[username].lastSeen) {
        userGroups[username].lastSeen = comment.comment_date;
      }
    });

    console.log(`   Found ${Object.keys(userGroups).length} unique prospects`);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Instagram Lead Engine';
    workbook.lastModifiedBy = 'Instagram Lead Engine';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Sheet 1: Prospect Summary (new main sheet)
    const prospectSummarySheet = workbook.addWorksheet('Prospect Summary', {
      properties: { tabColor: { argb: 'FF0070C0' } }
    });

    // Define columns for prospect summary
    prospectSummarySheet.columns = [
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Profile URL', key: 'profile_url', width: 35 },
      { header: 'Full Name', key: 'full_name', width: 25 },
      { header: 'Total Comments', key: 'comment_count', width: 15 },
      { header: 'Avg Quality', key: 'avg_quality', width: 12 },
      { header: 'Engagement Score', key: 'engagement_score', width: 18 },
      { header: 'Engagement Level', key: 'engagement_level', width: 18 },
      { header: 'Latest Comment', key: 'latest_comment', width: 50 },
      { header: 'First Seen', key: 'first_seen', width: 15 },
      { header: 'Last Seen', key: 'last_seen', width: 15 },
      { header: 'Sources', key: 'sources', width: 30 }
    ];

    // Process and add prospect data
    const prospectRows = [];
    Object.values(userGroups).forEach(user => {
      // Calculate engagement score
      const engagement = calculateEngagementScore(user.comments);
      
      // Calculate average quality score
      const avgQuality = user.qualityScores.length > 0
        ? (user.qualityScores.reduce((a, b) => a + b, 0) / user.qualityScores.length).toFixed(1)
        : 'N/A';
      
      // Find latest comment
      const latestComment = user.comments.reduce((latest, current) => {
        return new Date(current.comment_date) > new Date(latest.comment_date) ? current : latest;
      });
      
      prospectRows.push({
        username: user.username,
        profile_url: user.profile_url,
        full_name: user.full_name,
        comment_count: user.comments.length,
        avg_quality: avgQuality,
        engagement_score: engagement.score,
        engagement_level: engagement.level,
        latest_comment: latestComment.comment_text.substring(0, 100) + (latestComment.comment_text.length > 100 ? '...' : ''),
        first_seen: new Date(user.firstSeen).toLocaleDateString(),
        last_seen: new Date(user.lastSeen).toLocaleDateString(),
        sources: Array.from(user.sources).join(', ')
      });
    });

    // Sort by engagement score (highest first)
    prospectRows.sort((a, b) => b.engagement_score - a.engagement_score);

    // Add rows to sheet
    prospectRows.forEach(row => {
      const excelRow = prospectSummarySheet.addRow(row);
      
      // Color code engagement levels
      const levelCell = excelRow.getCell('engagement_level');
      if (row.engagement_level === 'HIGH') {
        levelCell.font = { color: { argb: 'FF008000' }, bold: true };
        levelCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F5E9' }
        };
      } else if (row.engagement_level === 'MEDIUM') {
        levelCell.font = { color: { argb: 'FFFF8C00' }, bold: true };
        levelCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFF3E0' }
        };
      } else {
        levelCell.font = { color: { argb: 'FFFF0000' } };
        levelCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFEBEE' }
        };
      }
    });

    // Style the header row
    prospectSummarySheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    prospectSummarySheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    prospectSummarySheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Sheet 2: Top Prospects (HIGH engagement only)
    const topProspectsSheet = workbook.addWorksheet('Top Prospects', {
      properties: { tabColor: { argb: 'FF008000' } }
    });

    // Same columns as summary
    topProspectsSheet.columns = prospectSummarySheet.columns;
    
    // Filter and add only HIGH engagement prospects
    const topProspects = prospectRows.filter(p => p.engagement_level === 'HIGH');
    topProspects.forEach(row => {
      topProspectsSheet.addRow(row);
    });

    // Style the header
    topProspectsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    topProspectsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF008000' }
    };
    topProspectsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Sheet 3: All Comments (detailed view)
    const allCommentsSheet = workbook.addWorksheet('All Comments', {
      properties: { tabColor: { argb: 'FFC0C0C0' } }
    });

    // Define columns
    allCommentsSheet.columns = [
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Full Name', key: 'full_name', width: 25 },
      { header: 'Comment', key: 'comment_text', width: 50 },
      { header: 'Quality', key: 'quality_score', width: 10 },
      { header: 'Is Spam', key: 'is_spam', width: 10 },
      { header: 'Spam Reason', key: 'spam_reason', width: 15 },
      { header: 'Date', key: 'comment_date', width: 20 },
      { header: 'Source', key: 'source', width: 20 },
      { header: 'Post URL', key: 'post_url', width: 40 }
    ];

    // Add all comments (including spam for transparency)
    comments.forEach(comment => {
      const row = allCommentsSheet.addRow(comment);
      
      // Highlight spam rows
      if (comment.is_spam === 'true' || comment.is_spam === true) {
        row.eachCell(cell => {
          cell.font = { color: { argb: 'FF999999' }, italic: true };
        });
      }
    });

    // Style the header row
    allCommentsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    allCommentsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF808080' }
    };
    allCommentsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Sheet 4: By Source
    const bySourceSheet = workbook.addWorksheet('By Source', {
      properties: { tabColor: { argb: 'FF00B050' } }
    });

    // Group by source
    const sourceGroups = {};
    comments.forEach(comment => {
      const source = comment.source || 'unknown';
      if (!sourceGroups[source]) {
        sourceGroups[source] = [];
      }
      sourceGroups[source].push(comment);
    });

    // Add source summary
    bySourceSheet.columns = [
      { header: 'Source', key: 'source', width: 30 },
      { header: 'Total Comments', key: 'comment_count', width: 15 },
      { header: 'Unique Prospects', key: 'unique_prospects', width: 18 },
      { header: 'Percentage', key: 'percentage', width: 15 }
    ];

    Object.entries(sourceGroups).forEach(([source, sourceComments]) => {
      const uniqueUsers = new Set(sourceComments.map(c => c.username));
      bySourceSheet.addRow({
        source: source,
        comment_count: sourceComments.length,
        unique_prospects: uniqueUsers.size,
        percentage: `${((sourceComments.length / comments.length) * 100).toFixed(1)}%`
      });
    });

    // Style the header
    bySourceSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    bySourceSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' }
    };

    // Sheet 5: Statistics
    const statsSheet = workbook.addWorksheet('Statistics', {
      properties: { tabColor: { argb: 'FFFF0000' } }
    });

    // Calculate statistics
    const engagementStats = {
      high: prospectRows.filter(p => p.engagement_level === 'HIGH').length,
      medium: prospectRows.filter(p => p.engagement_level === 'MEDIUM').length,
      low: prospectRows.filter(p => p.engagement_level === 'LOW').length
    };

    const dateRange = comments.reduce((acc, comment) => {
      const date = new Date(comment.comment_date);
      if (!acc.min || date < acc.min) acc.min = date;
      if (!acc.max || date > acc.max) acc.max = date;
      return acc;
    }, { min: null, max: null });

    // Add statistics
    statsSheet.columns = [
      { header: 'Metric', key: 'metric', width: 35 },
      { header: 'Value', key: 'value', width: 35 }
    ];

    statsSheet.addRow({ metric: 'Total Comments (raw)', value: comments.length });
    statsSheet.addRow({ metric: 'Quality Comments (non-spam)', value: nonSpamComments.length });
    statsSheet.addRow({ metric: 'Spam Comments Filtered', value: spamComments.length });
    statsSheet.addRow({ metric: 'Spam Rate', value: `${((spamComments.length / comments.length) * 100).toFixed(1)}%` });
    statsSheet.addRow({ metric: '', value: '' }); // Separator
    statsSheet.addRow({ metric: 'Unique Prospects', value: Object.keys(userGroups).length });
    statsSheet.addRow({ metric: 'High Engagement Prospects', value: engagementStats.high });
    statsSheet.addRow({ metric: 'Medium Engagement Prospects', value: engagementStats.medium });
    statsSheet.addRow({ metric: 'Low Engagement Prospects', value: engagementStats.low });
    statsSheet.addRow({ metric: '', value: '' }); // Separator
    statsSheet.addRow({ metric: 'Average Comments per Prospect', value: (nonSpamComments.length / Object.keys(userGroups).length).toFixed(2) });
    statsSheet.addRow({ metric: 'Number of Sources', value: Object.keys(sourceGroups).length });
    statsSheet.addRow({ metric: 'Date Range', value: `${dateRange.min?.toLocaleDateString()} - ${dateRange.max?.toLocaleDateString()}` });
    statsSheet.addRow({ metric: 'Last Updated', value: new Date().toLocaleString() });

    // Style statistics
    statsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    statsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFF0000' }
    };

    // Apply borders to all sheets
    [prospectSummarySheet, topProspectsSheet, allCommentsSheet, bySourceSheet, statsSheet].forEach(sheet => {
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
          };
        });
      });
    });

    // Add autofilters to main sheets
    prospectSummarySheet.autoFilter = prospectSummarySheet.dimensions.ref;
    allCommentsSheet.autoFilter = allCommentsSheet.dimensions.ref;

    // Save the file
    await workbook.xlsx.writeFile(outputFile);

    console.log('\n✅ Excel database built successfully!');
    console.log(`   Total comments: ${comments.length}`);
    console.log(`   Unique prospects: ${Object.keys(userGroups).length}`);
    console.log(`   High engagement: ${engagementStats.high} prospects`);
    console.log(`   Medium engagement: ${engagementStats.medium} prospects`);
    console.log(`   Low engagement: ${engagementStats.low} prospects`);
    console.log(`   Sources: ${Object.keys(sourceGroups).join(', ')}`);
    console.log(`   Output: ${outputFile}`);
    console.log('\n📊 Sheets created:');
    console.log('   1. Prospect Summary - All prospects with engagement scores');
    console.log('   2. Top Prospects - HIGH engagement prospects only');
    console.log('   3. All Comments - Complete list of all comments');
    console.log('   4. By Source - Comments grouped by source');
    console.log('   5. Statistics - Summary metrics and insights');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
buildFinalExcel();