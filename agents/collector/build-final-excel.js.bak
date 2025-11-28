#!/usr/bin/env node

/**
 * Build final Excel database from master CSV
 * Creates a professional Excel file with multiple sheets and formatting
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    console.log(`📊 Building Excel from ${comments.length} prospects...`);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Instagram Lead Engine';
    workbook.lastModifiedBy = 'Instagram Lead Engine';
    workbook.created = new Date();
    workbook.modified = new Date();

    // Sheet 1: All Prospects
    const allProspectsSheet = workbook.addWorksheet('All Prospects', {
      properties: { tabColor: { argb: 'FF0070C0' } }
    });

    // Define columns
    allProspectsSheet.columns = [
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Full Name', key: 'full_name', width: 25 },
      { header: 'Comment', key: 'comment_text', width: 50 },
      { header: 'Date', key: 'comment_date', width: 20 },
      { header: 'Source', key: 'source', width: 20 },
      { header: 'Post URL', key: 'post_url', width: 40 }
    ];

    // Add data
    comments.forEach(comment => {
      allProspectsSheet.addRow(comment);
    });

    // Style the header row
    allProspectsSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    allProspectsSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0070C0' }
    };
    allProspectsSheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Sheet 2: By Source
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
      { header: 'Prospect Count', key: 'count', width: 15 },
      { header: 'Percentage', key: 'percentage', width: 15 }
    ];

    Object.entries(sourceGroups).forEach(([source, prospects]) => {
      bySourceSheet.addRow({
        source: source,
        count: prospects.length,
        percentage: `${((prospects.length / comments.length) * 100).toFixed(1)}%`
      });
    });

    // Style the header
    bySourceSheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    bySourceSheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF00B050' }
    };

    // Sheet 3: Statistics
    const statsSheet = workbook.addWorksheet('Statistics', {
      properties: { tabColor: { argb: 'FFFF0000' } }
    });

    // Calculate statistics
    const uniqueUsernames = new Set(comments.map(c => c.username));
    const dateRange = comments.reduce((acc, comment) => {
      const date = new Date(comment.comment_date);
      if (!acc.min || date < acc.min) acc.min = date;
      if (!acc.max || date > acc.max) acc.max = date;
      return acc;
    }, { min: null, max: null });

    // Add statistics
    statsSheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 30 }
    ];

    statsSheet.addRow({ metric: 'Total Prospects', value: comments.length });
    statsSheet.addRow({ metric: 'Unique Usernames', value: uniqueUsernames.size });
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
    [allProspectsSheet, bySourceSheet, statsSheet].forEach(sheet => {
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

    // Save the file
    await workbook.xlsx.writeFile(outputFile);

    console.log('\n✅ Excel database built successfully!');
    console.log(`   Total prospects: ${comments.length}`);
    console.log(`   Sources: ${Object.keys(sourceGroups).join(', ')}`);
    console.log(`   Output: ${outputFile}`);
    console.log('\n📊 Sheets created:');
    console.log('   1. All Prospects - Complete list of all prospects');
    console.log('   2. By Source - Prospects grouped by source');
    console.log('   3. Statistics - Summary metrics');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the script
buildFinalExcel();