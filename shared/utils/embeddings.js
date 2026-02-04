/**
 * Embeddings Utility
 *
 * Provides functions for generating and comparing text embeddings
 * using OpenAI's text-embedding-ada-002 model.
 */

import axios from 'axios';

const EMBEDDING_MODEL = 'text-embedding-ada-002';
const EMBEDDING_API_URL = 'https://api.openai.com/v1/embeddings';

/**
 * Generate an embedding vector for the given text
 * @param {string} text - The text to embed
 * @returns {Promise<number[]>} The embedding vector (1536 dimensions)
 */
export async function getEmbedding(text) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  // Truncate text if too long (ada-002 has 8191 token limit)
  const truncatedText = text.slice(0, 8000);

  const response = await axios.post(
    EMBEDDING_API_URL,
    {
      model: EMBEDDING_MODEL,
      input: truncatedText
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in a single API call
 * @param {string[]} texts - Array of texts to embed
 * @returns {Promise<number[][]>} Array of embedding vectors
 */
export async function getEmbeddings(texts) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  const truncatedTexts = texts.map(t => t.slice(0, 8000));

  const response = await axios.post(
    EMBEDDING_API_URL,
    {
      model: EMBEDDING_MODEL,
      input: truncatedTexts
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      }
    }
  );

  // Sort by index to maintain order
  return response.data.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
}

/**
 * Calculate cosine similarity between two vectors
 * @param {number[]} vecA - First vector
 * @param {number[]} vecB - Second vector
 * @returns {number} Similarity score between -1 and 1
 */
export function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Serialize an embedding vector for SQLite BLOB storage
 * @param {number[]} embedding - The embedding vector
 * @returns {Buffer} Binary buffer
 */
export function serializeEmbedding(embedding) {
  return Buffer.from(new Float32Array(embedding).buffer);
}

/**
 * Deserialize an embedding vector from SQLite BLOB
 * @param {Buffer} buffer - The binary buffer
 * @returns {number[]} The embedding vector
 */
export function deserializeEmbedding(buffer) {
  if (!buffer) return null;
  return Array.from(new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4));
}

/**
 * Find top-k most similar items from a list
 * @param {number[]} queryEmbedding - The query embedding
 * @param {Array<{embedding: number[], ...}>} items - Items with embeddings
 * @param {number} topK - Number of results to return
 * @param {number} threshold - Minimum similarity threshold
 * @returns {Array<{score: number, ...}>} Sorted results with scores
 */
export function findTopSimilar(queryEmbedding, items, topK = 5, threshold = 0.7) {
  return items
    .filter(item => item.embedding)
    .map(item => ({
      ...item,
      score: cosineSimilarity(queryEmbedding, item.embedding)
    }))
    .filter(item => item.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export default {
  getEmbedding,
  getEmbeddings,
  cosineSimilarity,
  serializeEmbedding,
  deserializeEmbedding,
  findTopSimilar
};
