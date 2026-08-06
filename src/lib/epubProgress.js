const STORAGE_PREFIX = 'junco-reader-epub-progress-v1:'

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
