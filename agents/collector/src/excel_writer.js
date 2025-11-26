/**
 * Excel CRM Writer Module
 * 
 * Manages the Instagram prospects CRM in Excel format with intelligent
 * deduplication and prospect tracking across multiple sheets.
 */

import ExcelJS from 'exceljs';
import { join } from 'path';
import { existsSync } from 'fs';

export class ExcelCRM {
  constructor(outputDir = './output') {
    this.outputDir = outputDir;
    this.filePath = join(outputDir, 'instagram_prospects.xlsx');
    this.workbook = new ExcelJS.Workbook();
    this.existingData = {
      prospects: new Map(),      // username -> prospect data
      comments: new Set()        // username:post_url:comment_text -> exists
    };
  }

  /**
   * Load existing Excel file or create new one
   */
  async load() {
    if (existsSync(this.filePath)) {
      try {
        await this.workbook.xlsx.readFile(this.filePath);
        console.log(`✅ Loaded existing Excel file: ${this.filePath}`);
        await this.loadExistingData();
      } catch (error) {
        console.error('Error loading Excel file, creating new one:', error);
        // Create a new workbook instance if loading failed
        this.workbook = new ExcelJS.Workbook();
        this.createNewWorkbook();
      }
    } else {
      this.createNewWorkbook();
      console.log(`📝 Created new Excel file: ${this.filePath}`);
    }
    
    return this;
  }

  /**
   * Create a new workbook with all sheets
   */
  createNewWorkbook() {
    // Sheet 1: Prospects overview
    const prospectsSheet = this.workbook.addWorksheet('Prospects');
    prospectsSheet.columns = [
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Profile URL', key: 'profile_url', width: 40 },
      { header: 'First Seen', key: 'first_seen', width: 15 },
      { header: 'Last Active', key: 'last_active', width: 15 },
      { header: 'Total Comments', key: 'total_comments', width: 15 },
      { header: 'Engagement Level', key: 'engagement_level', width: 18 },
      { header: 'Score', key: 'score', width: 10 },
      { header: 'Last Comment', key: 'last_comment_text', width: 50 },
      { header: 'Tags', key: 'tags', width: 30 },
      { header: 'Status', key: 'status', width: 15 }
    ];

    // Sheet 2: All comments history
    const historySheet = this.workbook.addWorksheet('Historique');
    historySheet.columns = [
      { header: 'Username', key: 'username', width: 20 },
      { header: 'Post URL', key: 'post_url', width: 40 },
      { header: 'Comment Text', key: 'comment_text', width: 60 },
      { header: 'Comment Date', key: 'comment_date', width: 20 },
      { header: 'Source Hashtag', key: 'hashtag_source', width: 20 },
      { header: 'Scraped At', key: 'scraped_at', width: 20 }
    ];

    // Sheet 3: Analytics dashboard
    const analyticsSheet = this.workbook.addWorksheet('Analytics');
    analyticsSheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 }
    ];

    // Add header styling
    [prospectsSheet, historySheet, analyticsSheet].forEach(sheet => {
      const headerRow = sheet.getRow(1);
      headerRow.font = { bold: true, size: 12 };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
      };
      headerRow.alignment = { horizontal: 'center' };
    });
  }

  /**
   * Load existing data into memory for deduplication
   */
  async loadExistingData() {
    // Load prospects
    const prospectsSheet = this.workbook.getWorksheet('Prospects');
    if (prospectsSheet) {
      prospectsSheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header
          const username = row.getCell(1).value; // Column A
          if (username) {
            this.existingData.prospects.set(username, {
              first_seen: row.getCell(3).value, // Column C
              total_comments: row.getCell(5).value || 0 // Column E
            });
          }
        }
      });
    }

    // Load comment keys for deduplication
    const historySheet = this.workbook.getWorksheet('Historique');
    if (historySheet) {
      historySheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header
          const username = row.getCell(1).value; // Column A
          const postUrl = row.getCell(2).value; // Column B
          const commentDate = row.getCell(4).value; // Column D
          
          if (username && postUrl && commentDate) {
            const key = `${username}:${postUrl}:${commentDate}`;
            this.existingData.comments.add(key);
          }
        }
      });
    }
  }

  /**
   * Process and add new comments
   * 
   * @param {Array} comments - Array of comment objects
   * @param {string} source - Source identifier (e.g., "hashtag:fitness")
   * @returns {Object} - Statistics about the update
   */
  async updateWithComments(comments, source = 'unknown') {
    const stats = {
      new_prospects: 0,
      new_comments: 0,
      duplicate_comments: 0
    };

    const now = new Date();
    const scrapedAt = now.toISOString();

    // Group comments by username
    const commentsByUser = new Map();
    for (const comment of comments) {
      if (!commentsByUser.has(comment.username)) {
        commentsByUser.set(comment.username, []);
      }
      commentsByUser.get(comment.username).push(comment);
    }

    // Update prospects sheet
    const prospectsSheet = this.workbook.getWorksheet('Prospects');
    const historySheet = this.workbook.getWorksheet('Historique');

    for (const [username, userComments] of commentsByUser) {
      const existingProspect = this.existingData.prospects.get(username);
      
      if (!existingProspect) {
        // New prospect
        stats.new_prospects++;
        
        // Find most recent comment
        const latestComment = userComments.reduce((latest, current) => {
          const currentDate = new Date(current.comment_date || 0);
          const latestDate = new Date(latest.comment_date || 0);
          return currentDate > latestDate ? current : latest;
        });

        // Calculate engagement
        const engagement = this.calculateEngagementScore(userComments);
        
        // Add to prospects sheet
        prospectsSheet.addRow({
          username: username,
          profile_url: userComments[0].profile_url,
          first_seen: now.toLocaleDateString(),
          last_active: now.toLocaleDateString(),
          total_comments: userComments.length,
          engagement_level: engagement.level,
          score: engagement.score,
          last_comment_text: latestComment.comment_text,
          tags: source,
          status: 'NEW'
        });

        // Update memory
        this.existingData.prospects.set(username, {
          first_seen: now.toLocaleDateString(),
          total_comments: userComments.length
        });
      } else {
        // Existing prospect - update
        const rowNumber = await this.findProspectRow(prospectsSheet, username);
        if (rowNumber) {
          const row = prospectsSheet.getRow(rowNumber);
          const currentTotal = row.getCell(5).value || 0; // Total Comments column
          
          // Find most recent comment
          const latestComment = userComments.reduce((latest, current) => {
            const currentDate = new Date(current.comment_date || 0);
            const latestDate = new Date(latest.comment_date || 0);
            return currentDate > latestDate ? current : latest;
          }, userComments[0]);
          
          // Calculate updated engagement
          const engagement = this.calculateEngagementScore(userComments);
          
          row.getCell(4).value = now.toLocaleDateString(); // Last Active column
          row.getCell(5).value = currentTotal + userComments.length; // Total Comments
          row.getCell(6).value = engagement.level; // Engagement Level
          row.getCell(7).value = engagement.score; // Score
          row.getCell(8).value = latestComment.comment_text; // Last Comment
          
          // Add source as tag if not already present
          const currentTags = row.getCell(9).value || ''; // Tags column (now column 9)
          if (!currentTags.includes(source)) {
            row.getCell(9).value = currentTags ? `${currentTags}, ${source}` : source;
          }
          
          row.commit();
        }
      }

      // Add comments to history
      for (const comment of userComments) {
        const commentKey = `${username}:${comment.post_url}:${comment.comment_text}`;
        
        if (!this.existingData.comments.has(commentKey)) {
          // New comment
          stats.new_comments++;
          historySheet.addRow({
            username: username,
            post_url: comment.post_url,
            comment_text: comment.comment_text,
            comment_date: comment.comment_date,
            hashtag_source: source,
            scraped_at: scrapedAt
          });
          
          this.existingData.comments.add(commentKey);
        } else {
          stats.duplicate_comments++;
        }
      }
    }

    // Update analytics
    await this.updateAnalytics(stats);

    return stats;
  }

  /**
   * Find row number for a prospect
   */
  async findProspectRow(sheet, username) {
    let rowNumber = null;
    sheet.eachRow((row, num) => {
      if (row.getCell(1).value === username) { // Column A
        rowNumber = num;
      }
    });
    return rowNumber;
  }

  /**
   * Calculate engagement score based on comment patterns
   * 
   * Enhanced algorithm considering:
   * - Frequency (number of comments)
   * - Recency (how recent are comments)
   * - Quality (comment length and content)
   * - Patterns (questions, emojis, keywords)
   */
  calculateEngagementScore(comments) {
    if (!comments || comments.length === 0) return 'LOW';
    
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

  /**
   * Update analytics sheet
   */
  async updateAnalytics(lastRunStats) {
    const sheet = this.workbook.getWorksheet('Analytics');
    
    // Clear existing data
    sheet.spliceRows(2, sheet.rowCount);
    
    // Add updated metrics
    const metrics = [
      { metric: 'Total Prospects', value: this.existingData.prospects.size },
      { metric: 'New Prospects (Last Run)', value: lastRunStats.new_prospects },
      { metric: 'Total Comments', value: this.existingData.comments.size },
      { metric: 'New Comments (Last Run)', value: lastRunStats.new_comments },
      { metric: 'Last Updated', value: new Date().toLocaleString() }
    ];

    metrics.forEach(metric => sheet.addRow(metric));
  }

  /**
   * Save the workbook to file
   */
  async save() {
    await this.workbook.xlsx.writeFile(this.filePath);
    console.log(`✅ Excel CRM saved to: ${this.filePath}`);
  }

  /**
   * Get summary statistics
   */
  getStats() {
    return {
      total_prospects: this.existingData.prospects.size,
      total_comments: this.existingData.comments.size,
      file_path: this.filePath
    };
  }
}