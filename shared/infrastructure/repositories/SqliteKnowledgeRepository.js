/**
 * SQLite Knowledge Repository
 *
 * Manages the RAG knowledge base and conversation embeddings.
 * Provides semantic search capabilities for enriching LLM context.
 */

import {
  serializeEmbedding,
  deserializeEmbedding,
  cosineSimilarity
} from '../../utils/embeddings.js';

/**
 * Create SQLite Knowledge Repository
 *
 * @param {Object} deps - Dependencies
 * @param {Function} deps.getDb - Function to get database instance
 * @returns {Object} Repository implementation
 */
export function createSqliteKnowledgeRepository({ getDb }) {
  return {
    // ==================== KNOWLEDGE BASE ====================

    /**
     * Get all knowledge entries for an account
     * @param {number} accountId
     * @returns {Promise<Array>}
     */
    async getByAccount(accountId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM knowledge_base
        WHERE account_id = ? AND is_active = 1
        ORDER BY usage_count DESC
      `).all(accountId);

      return rows.map(row => ({
        ...row,
        triggerKeywords: row.trigger_keywords ? JSON.parse(row.trigger_keywords) : [],
        embedding: deserializeEmbedding(row.embedding)
      }));
    },

    /**
     * Get knowledge entries by category
     * @param {number} accountId
     * @param {string} category - 'objection', 'faq', 'product', 'success_story', 'technique'
     * @returns {Promise<Array>}
     */
    async getByCategory(accountId, category) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM knowledge_base
        WHERE account_id = ? AND category = ? AND is_active = 1
        ORDER BY usage_count DESC
      `).all(accountId, category);

      return rows.map(row => ({
        ...row,
        triggerKeywords: row.trigger_keywords ? JSON.parse(row.trigger_keywords) : [],
        embedding: deserializeEmbedding(row.embedding)
      }));
    },

    /**
     * Search knowledge base by keywords (fast fallback)
     * @param {number} accountId
     * @param {string} text - Text to search in
     * @returns {Promise<Array>}
     */
    async searchByKeywords(accountId, text) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM knowledge_base
        WHERE account_id = ? AND is_active = 1
      `).all(accountId);

      const textLower = text.toLowerCase();
      const matches = [];

      for (const row of rows) {
        const keywords = row.trigger_keywords ? JSON.parse(row.trigger_keywords) : [];
        const matchedKeyword = keywords.find(kw => textLower.includes(kw.toLowerCase()));

        if (matchedKeyword) {
          matches.push({
            ...row,
            triggerKeywords: keywords,
            embedding: deserializeEmbedding(row.embedding),
            matchedKeyword
          });
        }
      }

      return matches;
    },

    /**
     * Save a knowledge entry
     * @param {Object} entry
     * @returns {Promise<Object>}
     */
    async save(entry) {
      const db = getDb();
      const embedding = entry.embedding ? serializeEmbedding(entry.embedding) : null;
      const triggerKeywords = entry.triggerKeywords ? JSON.stringify(entry.triggerKeywords) : null;

      if (entry.id) {
        db.prepare(`
          UPDATE knowledge_base SET
            category = ?,
            trigger_keywords = ?,
            situation = ?,
            content = ?,
            embedding = ?,
            is_active = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          entry.category,
          triggerKeywords,
          entry.situation,
          entry.content,
          embedding,
          entry.isActive ?? 1,
          entry.id
        );
        return entry;
      } else {
        const result = db.prepare(`
          INSERT INTO knowledge_base (
            account_id, category, trigger_keywords, situation, content, embedding
          ) VALUES (?, ?, ?, ?, ?, ?)
          RETURNING *
        `).get(
          entry.accountId,
          entry.category,
          triggerKeywords,
          entry.situation,
          entry.content,
          embedding
        );

        return {
          ...result,
          triggerKeywords: entry.triggerKeywords,
          embedding: entry.embedding
        };
      }
    },

    /**
     * Update embedding for a knowledge entry
     * @param {number} id
     * @param {number[]} embedding
     */
    async updateEmbedding(id, embedding) {
      const db = getDb();
      db.prepare(`
        UPDATE knowledge_base
        SET embedding = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(serializeEmbedding(embedding), id);
    },

    /**
     * Record usage of a knowledge entry
     * @param {number} id
     * @param {boolean} wasHelpful
     */
    async recordUsage(id, wasHelpful = null) {
      const db = getDb();

      if (wasHelpful === true) {
        db.prepare(`
          UPDATE knowledge_base
          SET usage_count = usage_count + 1,
              success_count = success_count + 1,
              success_rate = CAST(success_count + 1 AS REAL) / (usage_count + 1),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(id);
      } else if (wasHelpful === false) {
        db.prepare(`
          UPDATE knowledge_base
          SET usage_count = usage_count + 1,
              success_rate = CAST(success_count AS REAL) / (usage_count + 1),
              updated_at = datetime('now')
          WHERE id = ?
        `).run(id);
      } else {
        db.prepare(`
          UPDATE knowledge_base
          SET usage_count = usage_count + 1,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(id);
      }
    },

    /**
     * Delete a knowledge entry
     * @param {number} id
     */
    async delete(id) {
      const db = getDb();
      db.prepare('DELETE FROM knowledge_base WHERE id = ?').run(id);
    },

    // ==================== CONVERSATION EMBEDDINGS ====================

    /**
     * Get successful conversation embeddings for an account
     * @param {number} accountId
     * @returns {Promise<Array>}
     */
    async getSuccessfulConversations(accountId) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM conversation_embeddings
        WHERE account_id = ? AND outcome = 'converted'
        ORDER BY created_at DESC
        LIMIT 50
      `).all(accountId);

      return rows.map(row => ({
        ...row,
        embedding: deserializeEmbedding(row.embedding)
      }));
    },

    /**
     * Get conversation embeddings by outcome
     * @param {number} accountId
     * @param {string} outcome - 'converted', 'lost', 'pending'
     * @returns {Promise<Array>}
     */
    async getConversationsByOutcome(accountId, outcome) {
      const db = getDb();
      const rows = db.prepare(`
        SELECT * FROM conversation_embeddings
        WHERE account_id = ? AND outcome = ?
        ORDER BY created_at DESC
      `).all(accountId, outcome);

      return rows.map(row => ({
        ...row,
        embedding: deserializeEmbedding(row.embedding)
      }));
    },

    /**
     * Save a conversation embedding
     * @param {Object} data
     * @returns {Promise<Object>}
     */
    async saveConversationEmbedding(data) {
      const db = getDb();
      const embedding = data.embedding ? serializeEmbedding(data.embedding) : null;

      // Check if already exists for this lead
      const existing = db.prepare(`
        SELECT id FROM conversation_embeddings WHERE lead_id = ?
      `).get(data.leadId);

      if (existing) {
        db.prepare(`
          UPDATE conversation_embeddings SET
            conversation_summary = ?,
            embedding = ?,
            outcome = ?,
            funnel_step_reached = ?,
            updated_at = datetime('now')
          WHERE lead_id = ?
        `).run(
          data.summary,
          embedding,
          data.outcome,
          data.funnelStepReached,
          data.leadId
        );
        return { ...data, id: existing.id };
      } else {
        const result = db.prepare(`
          INSERT INTO conversation_embeddings (
            lead_id, account_id, conversation_summary, embedding, outcome, funnel_step_reached
          ) VALUES (?, ?, ?, ?, ?, ?)
          RETURNING *
        `).get(
          data.leadId,
          data.accountId,
          data.summary,
          embedding,
          data.outcome,
          data.funnelStepReached
        );

        return {
          ...result,
          embedding: data.embedding
        };
      }
    },

    /**
     * Update conversation outcome (when lead converts or is lost)
     * @param {number} leadId
     * @param {string} outcome
     */
    async updateConversationOutcome(leadId, outcome) {
      const db = getDb();
      db.prepare(`
        UPDATE conversation_embeddings
        SET outcome = ?, updated_at = datetime('now')
        WHERE lead_id = ?
      `).run(outcome, leadId);
    },

    // ==================== SEMANTIC SEARCH ====================

    /**
     * Semantic search in knowledge base
     * @param {number} accountId
     * @param {number[]} queryEmbedding
     * @param {Object} options
     * @returns {Promise<Array>}
     */
    async semanticSearchKnowledge(accountId, queryEmbedding, options = {}) {
      const { topK = 3, threshold = 0.75, category = null } = options;

      let entries;
      if (category) {
        entries = await this.getByCategory(accountId, category);
      } else {
        entries = await this.getByAccount(accountId);
      }

      return entries
        .filter(entry => entry.embedding)
        .map(entry => ({
          ...entry,
          score: cosineSimilarity(queryEmbedding, entry.embedding)
        }))
        .filter(entry => entry.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },

    /**
     * Semantic search in successful conversations
     * @param {number} accountId
     * @param {number[]} queryEmbedding
     * @param {Object} options
     * @returns {Promise<Array>}
     */
    async semanticSearchConversations(accountId, queryEmbedding, options = {}) {
      const { topK = 2, threshold = 0.7 } = options;

      const conversations = await this.getSuccessfulConversations(accountId);

      return conversations
        .filter(conv => conv.embedding)
        .map(conv => ({
          ...conv,
          score: cosineSimilarity(queryEmbedding, conv.embedding)
        }))
        .filter(conv => conv.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    },

    // ==================== STATS ====================

    /**
     * Get knowledge base stats for an account
     * @param {number} accountId
     * @returns {Promise<Object>}
     */
    async getStats(accountId) {
      const db = getDb();

      const kbStats = db.prepare(`
        SELECT
          COUNT(*) as total_entries,
          SUM(CASE WHEN embedding IS NOT NULL THEN 1 ELSE 0 END) as with_embeddings,
          SUM(usage_count) as total_usage,
          AVG(success_rate) as avg_success_rate,
          COUNT(DISTINCT category) as categories
        FROM knowledge_base
        WHERE account_id = ? AND is_active = 1
      `).get(accountId);

      const convStats = db.prepare(`
        SELECT
          COUNT(*) as total_conversations,
          SUM(CASE WHEN outcome = 'converted' THEN 1 ELSE 0 END) as converted,
          SUM(CASE WHEN outcome = 'lost' THEN 1 ELSE 0 END) as lost,
          AVG(funnel_step_reached) as avg_funnel_step
        FROM conversation_embeddings
        WHERE account_id = ?
      `).get(accountId);

      return {
        knowledgeBase: kbStats,
        conversations: convStats
      };
    }
  };
}

export default createSqliteKnowledgeRepository;
