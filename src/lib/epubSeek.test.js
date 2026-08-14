import { describe, expect, it } from 'vitest'

import {
  adjacentSection,
  chunkIndexForChapter,
  chunkIndexForOffset,
  chunkIndexForSection,
  nearestSection,
} from './epubSeek'

const chunks = [
  { chapterIndex: 0, chapterId: 'a', text: 'Hello world.', startOffset: 0, endOffset: 12 },
  { chapterIndex: 0, chapterId: 'a', text: 'More words here.', startOffset: 13, endOffset: 29 },
  { chapterIndex: 1, chapterId: 'b', text: 'Chapter two.', startOffset: 0, endOffset: 12 },
]

describe('epubSeek', () => {
  it('finds chapter and offset chunk indexes', () => {
    expect(chunkIndexForChapter(chunks, 1)).toBe(2)
    expect(chunkIndexForOffset(chunks, 0, 15)).toBe(1)
    expect(chunkIndexForOffset(chunks, 0, 0)).toBe(0)
  })

  it('uses the offset chunk when it already contains the section title', () => {
    const section = { title: 'Chapter two.', charOffset: 0 }
    expect(chunkIndexForSection(chunks, 1, section)).toBe(2)
  })

  it('chooses the title occurrence nearest the section offset', () => {
    const repeated = [
      { chapterIndex: 0, text: 'War appears in the introduction.', startOffset: 0, endOffset: 32 },
      { chapterIndex: 0, text: 'More introductory text.', startOffset: 33, endOffset: 56 },
      { chapterIndex: 0, text: 'War', startOffset: 57, endOffset: 60 },
      { chapterIndex: 0, text: 'The section body.', startOffset: 61, endOffset: 78 },
    ]
    expect(
      chunkIndexForSection(repeated, 0, { title: 'War', charOffset: 57 }),
    ).toBe(2)
  })

  it('finds nearest and adjacent sections', () => {
    const sections = [
      { id: '1', title: 'A', level: 1, charOffset: 0 },
      { id: '2', title: 'B', level: 2, charOffset: 40 },
      { id: '3', title: 'C', level: 2, charOffset: 90 },
    ]
    expect(nearestSection(sections, 55)?.id).toBe('2')
    expect(adjacentSection(sections, 55, 1)?.id).toBe('3')
    expect(adjacentSection(sections, 55, -1)?.id).toBe('1')
  })
})
