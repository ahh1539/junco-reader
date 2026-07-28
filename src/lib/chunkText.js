/**
 * Chunk text for TTS: short first chunk for time-to-first-audio,
 * then sentence-ish chunks (mirrors iOS ScriptChunker spirit).
 */

const FIRST_CHUNK_TARGET = 90
const CHUNK_TARGET = 350

function splitSentences(text) {
  const parts = text.match(/[^.!?…]+[.!?…]+[\s)"]*|[^.!?…]+$/g)
  if (!parts) return [text.trim()].filter(Boolean)
  return parts.map((p) => p.trim()).filter(Boolean)
}

export function chunkText(raw) {
  const text = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return []

  const sentences = splitSentences(text)
  const chunks = []
  let buf = ''
  let target = FIRST_CHUNK_TARGET

  for (const sentence of sentences) {
    if (!buf) {
      buf = sentence
      if (buf.length >= target) {
        chunks.push(buf)
        buf = ''
        target = CHUNK_TARGET
      }
      continue
    }

    if (buf.length + 1 + sentence.length <= target) {
      buf = `${buf} ${sentence}`
    } else {
      chunks.push(buf)
      buf = sentence
      target = CHUNK_TARGET
    }
  }

  if (buf) chunks.push(buf)
  return chunks
}
