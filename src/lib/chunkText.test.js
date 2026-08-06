import { describe, expect, it } from 'vitest'

import { chunkText, chunkTextWithOffsets } from './chunkText'

describe('chunkTextWithOffsets', () => {
  it('matches the existing chunk text while retaining normalized offsets', () => {
    const source = 'First sentence.\n\nSecond sentence repeats. Second sentence repeats.\nThird sentence.'
    const records = chunkTextWithOffsets(source)

    expect(records.map((record) => record.text)).toEqual(chunkText(source))
    expect(records[0]).toMatchObject({ startOffset: 0 })

    const normalized = source.replace(/\s+/g, ' ').trim()
    records.forEach((record) => {
      expect(normalized.slice(record.startOffset, record.endOffset)).toBe(record.text)
    })
  })

  it('returns no records for empty input', () => {
    expect(chunkTextWithOffsets('   ')).toEqual([])
  })
})
