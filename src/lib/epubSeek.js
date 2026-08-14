/**
 * Seek helpers for EPUB Listening Room: chapter / character / section → chunk.
 */

export function chapterStartIndexes(chunkRecords) {
  const starts = new Map()
  chunkRecords.forEach((chunk, index) => {
    if (!starts.has(chunk.chapterIndex)) starts.set(chunk.chapterIndex, index)
  })
  return starts
}

export function chunkIndexForChapter(chunkRecords, chapterIndex) {
  const starts = chapterStartIndexes(chunkRecords)
  return starts.get(chapterIndex) ?? 0
}

export function chunkIndexForOffset(chunkRecords, chapterIndex, characterOffset) {
  const chapterStart = chunkIndexForChapter(chunkRecords, chapterIndex)
  const offset = Math.max(0, Number(characterOffset) || 0)
  const matchingChunk = chunkRecords.findIndex(
    (chunk) => chunk.chapterIndex === chapterIndex && chunk.endOffset > offset,
  )
  return matchingChunk === -1 ? chapterStart : matchingChunk
}

/**
 * Prefer offset match; fall back to finding the section title in chapter chunks
 * (useful when Optimize for speech rewrites the spoken text).
 */
export function chunkIndexForSection(chunkRecords, chapterIndex, section) {
  if (!section) return chunkIndexForChapter(chunkRecords, chapterIndex)

  const byOffset = chunkIndexForOffset(chunkRecords, chapterIndex, section.charOffset)
  const title = String(section.title || '').trim()
  if (!title) return byOffset

  const needle = title.slice(0, Math.min(title.length, 48))
  const offsetChunk = chunkRecords[byOffset]
  if (offsetChunk?.chapterIndex === chapterIndex && offsetChunk.text.includes(needle)) {
    return byOffset
  }

  const targetOffset = Math.max(0, Number(section.charOffset) || 0)
  let nearestTitleMatch = -1
  let nearestDistance = Number.POSITIVE_INFINITY
  chunkRecords.forEach((chunk, index) => {
    if (chunk.chapterIndex !== chapterIndex || !chunk.text.includes(needle)) return
    const distance = Math.abs((chunk.startOffset ?? 0) - targetOffset)
    if (distance < nearestDistance) {
      nearestTitleMatch = index
      nearestDistance = distance
    }
  })
  return nearestTitleMatch === -1 ? byOffset : nearestTitleMatch
}

export function nearestSection(sections, characterOffset) {
  if (!sections?.length) return null
  const offset = Math.max(0, Number(characterOffset) || 0)
  let current = sections[0]
  for (const section of sections) {
    if (section.charOffset <= offset) current = section
    else break
  }
  return current
}

export function adjacentSection(sections, characterOffset, direction) {
  if (!sections?.length) return null
  const current = nearestSection(sections, characterOffset)
  if (!current) return null
  const index = sections.findIndex((section) => section.id === current.id)
  if (index < 0) return null
  if (direction < 0) return index > 0 ? sections[index - 1] : null
  return index < sections.length - 1 ? sections[index + 1] : null
}
