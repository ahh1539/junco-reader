import { describe, expect, it } from 'vitest'

import { formatForTts } from './formatForTts'

describe('formatForTts', () => {
  it('returns empty string for empty/nullish input', () => {
    expect(formatForTts('')).toBe('')
    expect(formatForTts(null)).toBe('')
    expect(formatForTts(undefined)).toBe('')
  })

  it('replaces bare URLs with their hostname', () => {
    expect(formatForTts('See https://www.example.com/path?q=1 for more.')).toBe(
      'See example.com for more.',
    )
  })

  it('speaks emails as "user at domain dot tld"', () => {
    expect(formatForTts('Contact jane.doe@example.com today.')).toBe(
      'Contact jane.doe at example dot com today.',
    )
  })

  it('strips numeric citation brackets', () => {
    expect(formatForTts('This is known [1] and also [12, 15].')).toBe(
      'This is known and also.',
    )
  })

  it('preserves markdown IPA overrides while still stripping citations', () => {
    const input = 'The word [tomato](/ipa/) appears in ref [3].'
    expect(formatForTts(input)).toBe('The word [tomato](/ipa/) appears in ref.')
  })

  it('strips emoji, including flag (regional indicator) emoji', () => {
    expect(formatForTts('Great job! 🎉👍')).toBe('Great job!')
    expect(formatForTts('Shipped from the US 🇺🇸 today.')).toBe('Shipped from the US today.')
  })

  it('removes standalone page-number lines', () => {
    expect(formatForTts('Intro text\n\n42\n\nMore text')).toBe('Intro text. More text')
    expect(formatForTts('Intro text\nPage 3 of 10\nMore text')).toBe('Intro text. More text')
  })

  it('rejoins hyphenated line breaks from PDF extraction', () => {
    expect(formatForTts('This is a hyphen-\nated word.')).toBe('This is a hyphenated word.')
  })

  it('expands light symbols and abbreviations', () => {
    expect(formatForTts('50% off, Prof. Smith vs. Prof. Jones, e.g. apples, i.e. fruit, approx. 5')).toBe(
      '50 percent off, Professor Smith versus Professor Jones, for example apples, that is fruit, approximately 5',
    )
  })

  it('formats a clear 10-digit phone number for pacing', () => {
    expect(formatForTts('Call 555-123-4567 now.')).toBe('Call 5 5 5, 1 2 3, 4 5 6 7 now.')
  })

  it('normalizes dashes and repeated punctuation for prosody', () => {
    expect(formatForTts('Wait — okay!!! sure???')).toBe('Wait - okay! sure?')
  })

  it('is deterministic (same input -> same output)', () => {
    const input = 'Visit https://example.com or email a@b.com, ref [4]. 🎉'
    expect(formatForTts(input)).toBe(formatForTts(input))
  })
})
