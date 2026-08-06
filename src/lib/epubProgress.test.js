import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearEpubProgress,
  fingerprintEpubBytes,
  loadEpubProgress,
  saveEpubProgress,
} from './epubProgress'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fingerprintEpubBytes', () => {
  it('creates a stable, byte-derived fingerprint', async () => {
    const first = new TextEncoder().encode('a small epub').buffer
    const same = new TextEncoder().encode('a small epub').buffer
    const different = new TextEncoder().encode('another epub').buffer

    await expect(fingerprintEpubBytes(first)).resolves.toBe(await fingerprintEpubBytes(same))
    expect(await fingerprintEpubBytes(first)).not.toBe(await fingerprintEpubBytes(different))
  })

  it('falls back to a byte-derived key when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined)
    await expect(fingerprintEpubBytes(new Uint8Array([1, 2, 3]))).resolves.toMatch(/^fnv1a-/)
  })
})

describe('EPUB listening progress', () => {
  it('stores only a chapter location and can retrieve it', () => {
    vi.stubGlobal('localStorage', memoryStorage())

    saveEpubProgress('book-fingerprint', {
      chapterId: 'chapter-3',
      chapterIndex: 2,
      characterOffset: 418,
      optimized: true,
    })

    expect(loadEpubProgress('book-fingerprint')).toMatchObject({
      chapterId: 'chapter-3',
      chapterIndex: 2,
      characterOffset: 418,
      optimized: true,
    })
  })

  it('drops malformed saved values instead of trusting them', () => {
    const localStorage = memoryStorage()
    localStorage.setItem('junco-reader-epub-progress-v1:book-fingerprint', '{not json')
    vi.stubGlobal('localStorage', localStorage)

    expect(loadEpubProgress('book-fingerprint')).toBeNull()
  })

  it('clears a completed book position', () => {
    vi.stubGlobal('localStorage', memoryStorage())
    saveEpubProgress('book-fingerprint', {
      chapterId: 'chapter-1',
      chapterIndex: 0,
      characterOffset: 10,
      optimized: false,
    })

    clearEpubProgress('book-fingerprint')
    expect(loadEpubProgress('book-fingerprint')).toBeNull()
  })
})
