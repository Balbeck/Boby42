'use strict'

const { describe, it } = require('node:test')
const assert = require('node:assert')

const { cosineSimilarity } = require('../../lib/cosine')

// The single number every retrieval decision is made on: MIN_SCORE, the
// SCORE_MARGIN cut and gateSubjectsPdf() all compare values produced here. A
// wrong result is perfectly silent — documents just come back subtly wrong.
describe('cosineSimilarity', () => {
  it('is 1 for a vector against itself', () => {
    const v = [0.2, -0.7, 0.1, 0.9]
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-12)
  })

  it('is 1 for parallel vectors of different magnitude (scale-free)', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2, 3], [10, 20, 30]) - 1) < 1e-12)
  })

  it('is 0 for orthogonal vectors', () => {
    assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0)
  })

  it('is -1 for opposite vectors', () => {
    assert.ok(Math.abs(cosineSimilarity([1, 2], [-1, -2]) + 1) < 1e-12)
  })

  // Guards the explicit early return: without it this divides by zero and every
  // score becomes NaN, which silently compares false against every threshold —
  // retrieval would return nothing, with no error anywhere.
  it('is 0 when either vector is all zeros, rather than NaN', () => {
    assert.strictEqual(cosineSimilarity([0, 0, 0], [1, 2, 3]), 0)
    assert.strictEqual(cosineSimilarity([1, 2, 3], [0, 0, 0]), 0)
    assert.strictEqual(cosineSimilarity([0, 0], [0, 0]), 0)
  })

  // The loop is driven by vecA's length: a shorter vecB reads `undefined` and
  // poisons the sum. Pinned so a future "optimisation" that drops the guard is
  // caught here rather than in production scores.
  it('produces a finite number for equal-length vectors of any size', () => {
    const a = Array.from({ length: 1024 }, (_, i) => Math.sin(i))
    const b = Array.from({ length: 1024 }, (_, i) => Math.cos(i))
    const score = cosineSimilarity(a, b)
    assert.ok(Number.isFinite(score))
    assert.ok(score >= -1 && score <= 1)
  })
})
