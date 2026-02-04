/**
 * RAG Retriever Service
 *
 * Retrieves relevant context from the knowledge base and historical
 * conversations to enrich the LLM prompt for better responses.
 *
 * This service implements Retrieval-Augmented Generation (RAG) by:
 * 1. Generating an embedding of the current conversation context
 * 2. Finding semantically similar knowledge entries
 * 3. Finding similar successful conversations
 * 4. Formatting the results for injection into the system prompt
 */

import { getEmbedding } from '../../utils/embeddings.js';

export class RagRetriever {
  /**
   * @param {Object} deps
   * @param {Object} deps.knowledgeRepository - Knowledge base repository
   */
  constructor({ knowledgeRepository }) {
    this.knowledgeRepo = knowledgeRepository;
  }

  /**
   * Retrieve relevant context for a conversation
   *
   * @param {Object} params
   * @param {string} params.prospectMessage - Last message from the prospect
   * @param {Object} params.leadContext - Lead context (funnel_step, pain_points, etc.)
   * @param {number} params.accountId - Account ID
   * @param {Object} options
   * @param {number} options.topK - Number of knowledge results (default: 3)
   * @param {number} options.conversationTopK - Number of conversation results (default: 2)
   * @param {number} options.threshold - Minimum similarity threshold (default: 0.72)
   * @returns {Promise<Object>} RAG results
   */
  async retrieve({ prospectMessage, leadContext, accountId }, options = {}) {
    const {
      topK = 3,
      conversationTopK = 2,
      threshold = 0.72
    } = options;

    const results = {
      relevantKnowledge: [],
      similarConversations: [],
      keywordMatches: []
    };

    if (!prospectMessage || !accountId) {
      return results;
    }

    try {
      // 1. Build query text with context
      const queryText = this.buildQueryText(prospectMessage, leadContext);

      // 2. Generate embedding for the query
      const queryEmbedding = await getEmbedding(queryText);

      // 3. Semantic search in knowledge base
      results.relevantKnowledge = await this.knowledgeRepo.semanticSearchKnowledge(
        accountId,
        queryEmbedding,
        { topK, threshold }
      );

      // 4. Semantic search in successful conversations
      results.similarConversations = await this.knowledgeRepo.semanticSearchConversations(
        accountId,
        queryEmbedding,
        { topK: conversationTopK, threshold: 0.7 }
      );

      // 5. Keyword-based search as fallback/supplement
      results.keywordMatches = await this.knowledgeRepo.searchByKeywords(
        accountId,
        prospectMessage
      );

      // 6. Deduplicate (keyword matches might overlap with semantic)
      results.relevantKnowledge = this.deduplicateResults(
        results.relevantKnowledge,
        results.keywordMatches
      );

      // 7. Record usage for learning
      await this.recordUsage(results.relevantKnowledge);

    } catch (error) {
      console.error('[RagRetriever] Error during retrieval:', error.message);
      // Return empty results on error - graceful degradation
    }

    return results;
  }

  /**
   * Build the query text by combining message and context
   * @private
   */
  buildQueryText(prospectMessage, leadContext) {
    let query = prospectMessage;

    if (leadContext) {
      if (leadContext.pain_points) {
        query += ` [Problemes: ${leadContext.pain_points}]`;
      }
      if (leadContext.funnel_step) {
        query += ` [Etape: ${leadContext.funnel_step}]`;
      }
      if (leadContext.goals) {
        query += ` [Objectifs: ${leadContext.goals}]`;
      }
    }

    return query;
  }

  /**
   * Deduplicate results from semantic and keyword searches
   * @private
   */
  deduplicateResults(semanticResults, keywordResults) {
    const seenIds = new Set(semanticResults.map(r => r.id));

    // Add keyword matches that weren't found semantically
    for (const kw of keywordResults) {
      if (!seenIds.has(kw.id)) {
        semanticResults.push({
          ...kw,
          score: 0.8, // Assign a good score for keyword matches
          matchType: 'keyword'
        });
        seenIds.add(kw.id);
      }
    }

    return semanticResults.sort((a, b) => b.score - a.score);
  }

  /**
   * Record that knowledge entries were used
   * @private
   */
  async recordUsage(entries) {
    for (const entry of entries) {
      try {
        await this.knowledgeRepo.recordUsage(entry.id);
      } catch (e) {
        // Non-critical, continue
      }
    }
  }

  /**
   * Format RAG results for injection into the system prompt
   *
   * @param {Object} ragResults - Results from retrieve()
   * @returns {string} Formatted context for the prompt
   */
  formatForPrompt(ragResults) {
    const parts = [];

    // Format relevant knowledge
    if (ragResults.relevantKnowledge && ragResults.relevantKnowledge.length > 0) {
      parts.push('**CONNAISSANCES PERTINENTES (utilise ces infos si applicable) :**');

      for (const kb of ragResults.relevantKnowledge) {
        const categoryLabel = this.getCategoryLabel(kb.category);
        const confidence = Math.round(kb.score * 100);

        parts.push(`\n[${categoryLabel}] (pertinence: ${confidence}%)`);
        if (kb.situation) {
          parts.push(`Situation: ${kb.situation}`);
        }
        parts.push(`${kb.content}`);
      }
    }

    // Format similar successful conversations
    if (ragResults.similarConversations && ragResults.similarConversations.length > 0) {
      parts.push('\n**APPROCHES QUI ONT CONVERTI (situations similaires) :**');

      for (const conv of ragResults.similarConversations) {
        const confidence = Math.round(conv.score * 100);
        parts.push(`- (${confidence}% similaire) ${conv.conversation_summary}`);
      }
    }

    return parts.join('\n');
  }

  /**
   * Get human-readable category label
   * @private
   */
  getCategoryLabel(category) {
    const labels = {
      objection: 'OBJECTION',
      faq: 'FAQ',
      product: 'PRODUIT/SERVICE',
      success_story: 'TEMOIGNAGE',
      technique: 'TECHNIQUE'
    };
    return labels[category] || category.toUpperCase();
  }

  /**
   * Check if RAG results are meaningful
   *
   * @param {Object} ragResults
   * @returns {boolean}
   */
  hasRelevantResults(ragResults) {
    return (
      (ragResults.relevantKnowledge && ragResults.relevantKnowledge.length > 0) ||
      (ragResults.similarConversations && ragResults.similarConversations.length > 0)
    );
  }
}

export default RagRetriever;
