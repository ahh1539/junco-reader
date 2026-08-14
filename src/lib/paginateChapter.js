/** Turn a chapter into headings + spoken chunks for the shared EPUB scroller. */

/**
 * @param {{ text: string, sections?: { id: string, title: string, level: number, charOffset: number }[] }} chapter
 * @param {{ text: string, startOffset: number, endOffset: number, globalIndex: number }[]} chapterChunks
 */
export function buildChapterUnits(chapter, chapterChunks) {
  const sections = [...(chapter?.sections || [])].sort((a, b) => a.charOffset - b.charOffset)
  const units = []
  let sectionCursor = 0

  for (const chunk of chapterChunks) {
    while (
      sectionCursor < sections.length &&
      sections[sectionCursor].charOffset <= chunk.startOffset
    ) {
      const section = sections[sectionCursor]
      sectionCursor += 1
      // Skip decorative heading chips when the spoken chunk already opens with
      // the same title — avoids doubled, colliding lines in the leaf.
      const opensWithTitle = chunk.text.trimStart().toLowerCase().startsWith(section.title.toLowerCase())
      if (opensWithTitle) continue
      units.push({
        type: 'heading',
        id: section.id,
        title: section.title,
        level: section.level,
        charOffset: section.charOffset,
        sectionId: section.id,
      })
    }

    units.push({
      type: 'chunk',
      id: `chunk-${chunk.globalIndex}`,
      text: chunk.text,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      globalIndex: chunk.globalIndex,
      localIndex: chunk.localIndex,
    })
  }

  while (sectionCursor < sections.length) {
    const section = sections[sectionCursor]
    units.push({
      type: 'heading',
      id: section.id,
      title: section.title,
      level: section.level,
      charOffset: section.charOffset,
      sectionId: section.id,
    })
    sectionCursor += 1
  }

  return units
}
