/** A small breath between complete sentences without slowing technical chunk joins. */
export const SENTENCE_GAP_MS = 120

const SENTENCE_END = /[.!?]["'”’\])}]*\s*$/

export function interChunkPauseMs(text) {
  return SENTENCE_END.test(String(text || '')) ? SENTENCE_GAP_MS : 0
}

export function interChunkPauseSeconds(text) {
  return interChunkPauseMs(text) / 1000
}
