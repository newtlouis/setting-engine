#!/usr/bin/env node

/**
 * Build Final Excel Report from SQLite Database
 * 
 * Creates a professional Excel file with multiple sheets:
 * - Prospect Summary: All leads with engagement scores
 * - Top Prospects: HIGH engagement only
 * - All Comments: Complete history
 * - By Source: Comments grouped by source
 * - Statistics: Summary metrics
 */

import { promises as fs } from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';
import {
  initDatabase,
  closeDatabase,
  getLeads,
  getComments,
  getCommentsForLead,
  getStats
} from './src/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function buildFinalExcel() {
  const permanentDir = path.join(__dirname, 'permanent-data');
  const outputDir = path.join(__dirname, 'output');
  const dbFile = path.join(permanentDir, 'leads.db');
  const outputFile = path.join(outputDir, 'instagram_final_database.xlsx');

  try {
    // Check if database exists
    try {
      await fs.access(dbFile);
    } catch {
      console.log('❌ No leads.db found');
      console.log('   Run "npm run save-comments" first to create the database');
      return;
    }

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Initialize database
    await initDatabase(dbFile);
    
    const stats = getStats();
    
    if (stats.total_leads === 0) {
      console.log('⚠️  Database is empty');
      closeDatabase();
      return;
    }

    console.log(`📊 Building Excel from ${stats.total_leads} leads and ${stats.total_comments} comments...`);

    // Get all leads
    const leads = getLeads();
    
    // Get all comments (with lead info)
    const allComments = getComments();
    const nonSpamComments = getComments({ is_spam: false });

    console.log(`   Non-spam comments: ${nonSpamComments.length}`);
    console.log(`   Spam comments filtered: ${stats.spam_comments}`);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Instagram Lead Engine';
    workbook.lastModifiedBy = 'Instagram Lead Engine';
    workbook.created = new Date();
    workbook.modified = new Date();

    // =============================================
    // Sheet 1: Prospect Summary
    // =============================================
    const prospectSummarySheet = workbook.addWorksheet('Prospect Summary', {
      properties: { tabColor: { argb: 'FF0070C0' } }
    });

    prospectSummarySheet.columns = [
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Profile URL', key: 'profile_url', width: 35 },
      { header: 'Full Name', key: 'full_name', width: 25 },
      { header: 'Followers', key: 'followers_count', width: 12 },
      { header: 'Total Comments', key: 'total_comments', width: 15 },
      { header: 'Engagement Score', key: 'engagement_score', width: 18 },
      { header: 'Engagement Level', key: 'engagement_level', width: 18 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Bio', key: 'bio', width: 40 },
      { header: 'First Seen', key: 'first_seen_at', width: 15 },
      { header: 'Last Seen', key: 'last_seen_at', width: 15 }
    ];

    // Add lead rows
    for (const lead of leads) {
      const row = prospectSummarySheet.addRow({
        username: lead.username,
        profile_url: lead.profile_url || `https://instagram.com/${lead.username}/`,
        full_name: lead.full_name || '',
        followers_count: lead.followers_count || '',
        total_comments: lead.total_comments,
        engagement_score: lead.engagement_score,
        engagement_level: lead.engagement_level,
        status: lead.status,
        bio: (lead.bio || '').substring(0, 100),
        first_seen_at: lead.first_seen_at ? new Date(lead.first_seen_at).toLocaleDateString() : '',
        last_seen_at: lead.last_seen_at ? new Date(lead.last_seen_at).toLocaleDateString() : ''
      });

      // Color code engagement levels
      const levelCell = row.getCell('engagement_level');
      if (lead.engagement_level === 'HIGH') {
        levelCell.font = { color: { argb: 'FF008000' }, bold: true };
        levelCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F5E9' }
        };
      } else if (lead.engagement_level === 'MEDIUM') {
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
      
      // Color code status
      const statusCell = row.getCell('status');
      if (lead.status === 'contacted') {
        statusCell.font = { color: { argb: 'FF0000FF' } };
      } else if (lead.status === 'replied') {
        statusCell.font = { color: { argb: 'FF008000' }, bold: true };
      } else if (lead.status === 'converted') {
        statusCell.font = { color: { argb: 'FF008000' }, bold: true };
        statusCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE8F5E9' }
        };
      }
    }

    // Style header
    styleHeaderRow(prospectSummarySheet, 'FF0070C0');

    // =============================================
    // Sheet 2: Top Prospects (HIGH engagement)
    // =============================================
    const topProspectsSheet = workbook.addWorksheet('Top Prospects', {
      properties: { tabColor: { argb: 'FF008000' } }
    });

    topProspectsSheet.columns = prospectSummarySheet.columns;
    
    const topLeads = leads.filter(l => l.engagement_level === 'HIGH');
    for (const lead of topLeads) {
      const comments = getCommentsForLead(lead.id).filter(c => !c.is_spam);
      const latestComment = comments[0]; // Already sorted by date desc
      
      topProspectsSheet.addRow({
        username: lead.username,
        profile_url: lead.profile_url || `https://instagram.com/${lead.username}/`,
        full_name: lead.full_name || '',
        followers_count: lead.followers_count || '',
        total_comments: lead.total_comments,
        engagement_score: lead.engagement_score,
        engagement_level: lead.engagement_level,
        status: lead.status,
        bio: (lead.bio || '').substring(0, 100),
        first_seen_at: lead.first_seen_at ? new Date(lead.first_seen_at).toLocaleDateString() : '',
        last_seen_at: lead.last_seen_at ? new Date(lead.last_seen_at).toLocaleDateString() : ''
      });
    }

    styleHeaderRow(topProspectsSheet, 'FF008000');

    // =============================================
    // Sheet 3: All Comments
    // =============================================
    const allCommentsSheet = workbook.addWorksheet('All Comments', {
      properties: { tabColor: { argb: 'FFC0C0C0' } }
    });

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

    for (const comment of allComments) {
      const row = allCommentsSheet.addRow({
        username: comment.username,
        full_name: comment.full_name || '',
        comment_text: comment.comment_text,
        quality_score: comment.quality_score,
        is_spam: comment.is_spam ? 'Yes' : 'No',
        spam_reason: comment.spam_reason || '',
        comment_date: comment.comment_date || '',
        source: comment.source || '',
        post_url: comment.post_url || ''
      });

      // Grey out spam
      if (comment.is_spam) {
        row.eachCell(cell => {
          cell.font = { color: { argb: 'FF999999' }, italic: true };
        });
      }
    }

    styleHeaderRow(allCommentsSheet, 'FF808080');

    // =============================================
    // Sheet 4: By Source
    // =============================================
    const bySourceSheet = workbook.addWorksheet('By Source', {
      properties: { tabColor: { argb: 'FF00B050' } }
    });

    bySourceSheet.columns = [
      { header: 'Source', key: 'source', width: 30 },
      { header: 'Total Comments', key: 'comment_count', width: 15 },
      { header: 'Unique Prospects', key: 'unique_prospects', width: 18 },
      { header: 'Percentage', key: 'percentage', width: 15 }
    ];

    // Group by source
    const sourceGroups = {};
    for (const comment of allComments) {
      const source = comment.source || 'unknown';
      if (!sourceGroups[source]) {
        sourceGroups[source] = { comments: 0, users: new Set() };
      }
      sourceGroups[source].comments++;
      sourceGroups[source].users.add(comment.username);
    }

    for (const [source, data] of Object.entries(sourceGroups)) {
      bySourceSheet.addRow({
        source,
        comment_count: data.comments,
        unique_prospects: data.users.size,
        percentage: `${((data.comments / allComments.length) * 100).toFixed(1)}%`
      });
    }

    styleHeaderRow(bySourceSheet, 'FF00B050');

    // =============================================
    // Sheet 5: Statistics
    // =============================================
    const statsSheet = workbook.addWorksheet('Statistics', {
      properties: { tabColor: { argb: 'FFFF0000' } }
    });

    statsSheet.columns = [
      { header: 'Metric', key: 'metric', width: 35 },
      { header: 'Value', key: 'value', width: 35 }
    ];

    // Format engagement distribution
    const engagementDist = {};
    stats.leads_by_engagement.forEach(e => {
      engagementDist[e.engagement_level] = e.count;
    });

    // Format status distribution
    const statusDist = {};
    stats.leads_by_status.forEach(s => {
      statusDist[s.status] = s.count;
    });

    const statsRows = [
      { metric: 'Total Comments', value: stats.total_comments },
      { metric: 'Quality Comments (non-spam)', value: stats.total_comments - stats.spam_comments },
      { metric: 'Spam Comments Filtered', value: stats.spam_comments },
      { metric: 'Spam Rate', value: `${((stats.spam_comments / stats.total_comments) * 100).toFixed(1)}%` },
      { metric: '', value: '' },
      { metric: 'Unique Prospects', value: stats.total_leads },
      { metric: 'High Engagement Prospects', value: engagementDist.HIGH || 0 },
      { metric: 'Medium Engagement Prospects', value: engagementDist.MEDIUM || 0 },
      { metric: 'Low Engagement Prospects', value: engagementDist.LOW || 0 },
      { metric: '', value: '' },
      { metric: 'Leads - New', value: statusDist.new || 0 },
      { metric: 'Leads - Contacted', value: statusDist.contacted || 0 },
      { metric: 'Leads - Replied', value: statusDist.replied || 0 },
      { metric: 'Leads - Converted', value: statusDist.converted || 0 },
      { metric: '', value: '' },
      { metric: 'Average Comments per Prospect', value: (stats.total_comments / stats.total_leads).toFixed(2) },
      { metric: 'Number of Sources', value: stats.comments_by_source.length },
      { metric: 'Last Updated', value: new Date().toLocaleString() }
    ];

    for (const row of statsRows) {
      statsSheet.addRow(row);
    }

    styleHeaderRow(statsSheet, 'FFFF0000');

    // =============================================
    // Apply borders to all sheets
    // =============================================
    [prospectSummarySheet, topProspectsSheet, allCommentsSheet, bySourceSheet, statsSheet].forEach(sheet => {
      sheet.eachRow((row) => {
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

    // Add autofilters
    if (prospectSummarySheet.rowCount > 1) {
      prospectSummarySheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: prospectSummarySheet.rowCount, column: prospectSummarySheet.columnCount }
      };
    }
    if (allCommentsSheet.rowCount > 1) {
      allCommentsSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: allCommentsSheet.rowCount, column: allCommentsSheet.columnCount }
      };
    }

    // Save the file
    await workbook.xlsx.writeFile(outputFile);

    console.log('\n✅ Excel database built successfully!');
    console.log('─'.repeat(50));
    console.log(`   Total leads:      ${stats.total_leads}`);
    console.log(`   Total comments:   ${stats.total_comments}`);
    console.log(`   High engagement:  ${engagementDist.HIGH || 0} prospects`);
    console.log(`   Medium engagement: ${engagementDist.MEDIUM || 0} prospects`);
    console.log(`   Low engagement:   ${engagementDist.LOW || 0} prospects`);
    console.log(`   Sources:          ${stats.comments_by_source.map(s => s.source).join(', ')}`);
    console.log(`   Output:           ${outputFile}`);
    console.log('\n📊 Sheets created:');
    console.log('   1. Prospect Summary - All prospects with engagement scores');
    console.log('   2. Top Prospects - HIGH engagement prospects only');
    console.log('   3. All Comments - Complete list of all comments');
    console.log('   4. By Source - Comments grouped by source');
    console.log('   5. Statistics - Summary metrics and insights');

    closeDatabase();

  } catch (error) {
    console.error('❌ Error:', error.message);
    closeDatabase();
    process.exit(1);
  }
}

/**
 * Style header row with color
 */
function styleHeaderRow(sheet, color) {
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: color }
  };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
}

// Run the script
buildFinalExcel();
