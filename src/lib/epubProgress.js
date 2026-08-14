const STORAGE_PREFIX = 'junco-reader-epub-progress-v1:'

/** Build per-chapter lengths in the same coordinate space as chunk offsets. */
export function chapterCoordinateLengths(chunkRecords, chapterCount = 0) {
  const lengths = Array.from({ length: Math.max(0, chapterCount) }, () => 0)
  for (const chunk of chunkRecords || []) {
    const chapterIndex = Number(chunk?.chapterIndex)
    if (!Number.isInteger(chapterIndex) || chapterIndex < 0) continue
    while (lengths.length <= chapterIndex) lengths.push(0)
    lengths[chapterIndex] = Math.max(lengths[chapterIndex], Number(chunk.endOffset) || 0)
  }
  return lengths
}

export function chapterProgressPercent(chapterLength, characterOffset) {
  const total = Math.max(0, Number(chapterLength) || 0)
  if (!total) return 0
  const offset = Math.max(0, Number(characterOffset) || 0)
  return Math.min(100, Math.round((offset / total) * 100))
}

export function bookProgressPercent(chapterLengths, chapterIndex, characterOffset) {
  if (!chapterLengths?.length) return 0
  const safeIndex = Math.min(
    chapterLengths.length - 1,
    Math.max(0, Number.isInteger(chapterIndex) ? chapterIndex : 0),
  )
  const total = chapterLengths.reduce((sum, length) => sum + (Number(length) || 0), 0)
  if (!total) return 0
  const before = chapterLengths
    .slice(0, safeIndex)
    .reduce((sum, length) => sum + (Number(length) || 0), 0)
  const chapterLength = Number(chapterLengths[safeIndex]) || 0
  const offset = Math.min(chapterLength, Math.max(0, Number(characterOffset) || 0))
  return Math.min(100, Math.max(0, Math.round(((before + offset) / total) * 100)))
}

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function storageKey(fingerprint) {
  return fingerprint ? `${STORAGE_PREFIX}${fingerprint}` : null
}

function fallbackFingerprint(bytes) {
  // A non-cryptographic fallback for old browsers without Web Crypto. It is
  // derived from file bytes rather than a title or filename, so storage still
  // does not reveal either. Modern browsers use SHA-256 below.
  let hash = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a-${(hash >>> 0).toString(16)}-${bytes.length}`
}

/**
 * @param {ArrayBuffer | Uint8Array} source
 * @returns {Promise<string>}
 */
export async function fingerprintEpubBytes(source) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest(
        'SHA-256',
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      )
      return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch {
    // Continue to the byte-derived fallback. Resume is a convenience and
    // should never prevent a book from opening.
  }
  return fallbackFingerprint(bytes)
}

/**
 * @returns {{ chapterId: string, chapterIndex: number, characterOffset: number, optimized: boolean } | null}
 */
export function loadEpubProgress(fingerprint) {
  const key = storageKey(fingerprint)
  const store = localStore()
  if (!key || !store) return null
  try {
    const value = JSON.parse(store.getItem(key) || 'null')
    if (
      !value ||
      typeof value.chapterId !== 'string' ||
      !Number.isInteger(value.chapterIndex) ||
      value.chapterIndex < 0 ||
      !Number.isFinite(value.characterOffset) ||
      value.characterOffset < 0
    ) {
      return null
    }
    return {
      chapterId: value.chapterId,
      chapterIndex: value.chapterIndex,
      characterOffset: value.characterOffset,
      optimized: Boolean(value.optimized),
    }
  } catch {
    return null
  }
}

export function saveEpubProgress(fingerprint, progress) {
  const key = storageKey(fingerprint)
  const store = localStore()
  if (!key || !store || !progress?.chapterId) return
  try {
    store.setItem(
      key,
      JSON.stringify({
        chapterId: progress.chapterId,
        chapterIndex: Math.max(0, Math.trunc(progress.chapterIndex || 0)),
        characterOffset: Math.max(0, Math.trunc(progress.characterOffset || 0)),
        optimized: Boolean(progress.optimized),
      }),
    )
  } catch {
    // Storage can be disabled or full. Playback remains fully usable.
  }
}

export function clearEpubProgress(fingerprint) {
  const key = storageKey(fingerprint)
  const store = localStore()
  if (!key || !store) return
  try {
    store.removeItem(key)
  } catch {
    /* ignore */
  }
}
