import { describe, expect, it } from 'vitest'

import { buildChapterUnits } from './paginateChapter'

describe('paginateChapter', () => {
  it('skips section headings when the spoken chunk already opens with that title', () => {
    const units = buildChapterUnits(
      {
        text: 'Title\n\nBody text here.',
        sections: [{ id: 's1', title: 'Title', level: 1, charOffset: 0 }],
      },
      [
        { text: 'Title', startOffset: 0, endOffset: 5, globalIndex: 10, localIndex: 0 },
        { text: 'Body text here.', startOffset: 7, endOffset: 22, globalIndex: 11, localIndex: 1 },
      ],
    )

    expect(units[0]).toMatchObject({ type: 'chunk', globalIndex: 10 })
    expect(units[1]).toMatchObject({ type: 'chunk', globalIndex: 11 })
    expect(units.some((unit) => unit.type === 'heading')).toBe(false)
  })

  it('keeps headings that are not already spoken in the next chunk', () => {
    const units = buildChapterUnits(
      {
        text: 'A Turn\n\nBody text here.',
        sections: [{ id: 's1', title: 'A Turn', level: 2, charOffset: 0 }],
      },
      [{ text: 'Body text here.', startOffset: 8, endOffset: 23, globalIndex: 3, localIndex: 0 }],
    )

    expect(units[0]).toMatchObject({ type: 'heading', id: 's1', title: 'A Turn' })
    expect(units[1]).toMatchObject({ type: 'chunk', globalIndex: 3 })
  })
})
