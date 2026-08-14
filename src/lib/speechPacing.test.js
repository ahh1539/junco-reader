import { describe, expect, it } from 'vitest'

import { interChunkPauseMs, SENTENCE_GAP_MS } from './speechPacing.js'

describe('speech pacing', () => {
  it('adds a very short breath after complete sentence punctuation', () => {
    expect(interChunkPauseMs('A complete sentence.')).toBe(SENTENCE_GAP_MS)
    expect(interChunkPauseMs('A question?”')).toBe(SENTENCE_GAP_MS)
    expect(SENTENCE_GAP_MS).toBeGreaterThanOrEqual(100)
    expect(SENTENCE_GAP_MS).toBeLessThanOrEqual(150)
  })

  it('keeps technical chunk joins gapless when the thought continues', () => {
    expect(interChunkPauseMs('a phrase that continues')).toBe(0)
    expect(interChunkPauseMs('including a comma,')).toBe(0)
  })
})
