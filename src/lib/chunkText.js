/**
 * Chunk text for TTS streaming.
 *
 * First chunk is tiny for time-to-first-audio. Chunk size then ramps up
 * (RAMP_TARGETS) so the synthesized-audio buffer builds instead of falling
 * off a cliff right after the first chunk -- chunk 2 at full size would need
 * ~15s of synthesis to complete during chunk 1's ~3s of playback.
 *
 * Later EPUB chapters pass capIndexOffset past the ramp so they start at
 * cruise instead of repeating the 48-char TTFA split.
 */

const FIRST_CHUNK_TARGET = 48
export const RAMP_TARGETS = [90, 180, 350]
const CHUNK_TARGET = RAMP_TARGETS[RAMP_TARGETS.length - 1]
/** Offset that skips the TTFA ramp and starts at the cruise cap. */
export const CRUISE_CAP_INDEX = RAMP_TARGETS.length

/** Per-chunk character cap by position: chunk 0 is FIRST_CHUNK_TARGET, then ramps up. */
function capForChunkIndex(i) {
  if (i === 0) return FIRST_CHUNK_TARGET
  return RAMP_TARGETS[Math.min(i - 1, RAMP_TARGETS.length - 1)]
}

function splitSentences(text) {
  const parts = text.match(/[^.!?…]+[.!?…]+[\s)"]*|[^.!?…]+$/g)
  if (!parts) return [text.trim()].filter(Boolean)
  return parts.map((p) => p.trim()).filter(Boolean)
}

/** Prefer whitespace cuts so we never emit a giant first sentence. */
function hardSplit(text, maxChars) {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed ? [trimmed] : []

  const out = []
  let remainder = trimmed
  while (remainder.length > maxChars) {
    const head = remainder.slice(0, maxChars)
    const space = head.lastIndexOf(' ')
    if (space > 0) {
      out.push(remainder.slice(0, space).trim())
      remainder = remainder.slice(space + 1).trim()
    } else {
      out.push(head)
      remainder = remainder.slice(maxChars).trim()
    }
  }
  if (remainder) out.push(remainder)
  return out
}

function normalizeForChunking(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function chunkNormalizedText(text, { capIndexOffset = 0 } = {}) {
  if (!text) return []

  const sentences = splitSentences(text)
  let units = []
  for (const sentence of sentences) {
    const pieces = hardSplit(sentence, CHUNK_TARGET)
    pieces.forEach((piece, i) => {
      units.push({ text: piece, mustStart: i > 0 })
    })
  }

  // Tiny first-unit split is only for session/book start (TTFA). Later
  // chapters must be allowed to open at cruise size.
  if (capIndexOffset === 0 && units[0] && units[0].text.length > FIRST_CHUNK_TARGET) {
    const opening = hardSplit(units[0].text, FIRST_CHUNK_TARGET).map((piece, i) => ({
      text: piece,
      mustStart: i > 0,
    }))
    units = [...opening, ...units.slice(1)]
  }

  const chunks = []
  let buf = ''

  for (const unit of units) {
    const cap = capForChunkIndex(chunks.length + capIndexOffset)
    if (!buf) {
      buf = unit.text
    } else if (!unit.mustStart && buf.length + 1 + unit.text.length <= cap) {
      buf = `${buf} ${unit.text}`
    } else {
      chunks.push(buf)
      buf = unit.text
    }
  }
  if (buf) chunks.push(buf)
  return chunks
}

export function chunkText(raw, options) {
  return chunkNormalizedText(normalizeForChunking(raw), options)
}

/**
 * Chunk text while retaining offsets into the normalized text used for speech.
 * The offsets let long-form readers persist a useful resume point without
 * storing the book itself.
 *
 * @param {string} raw
 * @param {{ capIndexOffset?: number }} [options]
 * @returns {{ text: string, startOffset: number, endOffset: number }[]}
 */
export function chunkTextWithOffsets(raw, options) {
  const normalized = normalizeForChunking(raw)
  const chunks = chunkNormalizedText(normalized, options)
  let cursor = 0

  return chunks.map((text) => {
    // Each chunk comes directly from the normalized source. Search from the
    // previous end rather than relying on unique text -- repeated sentences
    // are common in books.
    const foundAt = normalized.indexOf(text, cursor)
    const startOffset = foundAt === -1 ? cursor : foundAt
    const endOffset = startOffset + text.length
    cursor = endOffset
    return { text, startOffset, endOffset }
  })
}
