'use strict'

/**
 * Computes the cosine similarity between two vectors of equal length.
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number} similarity between -1 and 1 (0 if either vector is a zero vector)
 */
function cosineSimilarity (vecA, vecB) {
  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i]
    normA += vecA[i] * vecA[i]
    normB += vecB[i] * vecB[i]
  }

  if (normA === 0 || normB === 0) {
    return 0
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB))
}

module.exports = { cosineSimilarity }
