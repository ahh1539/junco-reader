import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearShareParamFromUrl,
  hasIncomingShareParam,
  takeSharedFile,
  takeSharedText,
} from './incomingShare'

function createFakeCacheStorage(initialEntries = {}) {
  const store = new Map(Object.entries(initialEntries))
  const cache = {
    match: async (key) => store.get(key) ?? undefined,
    delete: async (key) => store.delete(key),
  }
  return { caches: { open: async () => cache }, store }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('takeSharedFile', () => {
  it('returns null when nothing is staged', async () => {
    const { caches } = createFakeCacheStorage()
    vi.stubGlobal('window', { caches })
    vi.stubGlobal('caches', caches)
    await expect(takeSharedFile()).resolves.toBeNull()
  })

  it('returns null when the Cache Storage API is unavailable', async () => {
    vi.stubGlobal('window', {})
    await expect(takeSharedFile()).resolves.toBeNull()
  })

  it('reconstructs a File with the staged name and type, then clears the entry', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' })
    const response = new Response(blob, {
      headers: {
        'Content-Type': 'text/plain',
        'X-Shared-Filename': encodeURIComponent('My Notes.txt'),
      },
    })
    const { caches, store } = createFakeCacheStorage({ '/__share/file': response })
    vi.stubGlobal('window', { caches })
    vi.stubGlobal('caches', caches)

    const file = await takeSharedFile()
    expect(file).toBeInstanceOf(File)
    expect(file.name).toBe('My Notes.txt')
    expect(await file.text()).toBe('hello world')
    expect(store.has('/__share/file')).toBe(false)
  })

  it('falls back to a generic name when the header is missing', async () => {
    const response = new Response(new Blob(['x']), { headers: {} })
    const { caches } = createFakeCacheStorage({ '/__share/file': response })
    vi.stubGlobal('window', { caches })
    vi.stubGlobal('caches', caches)

    const file = await takeSharedFile()
    expect(file.name).toBe('shared-file')
  })
})

describe('takeSharedText', () => {
  it('returns null when nothing is staged', async () => {
    const { caches } = createFakeCacheStorage()
    vi.stubGlobal('window', { caches })
    vi.stubGlobal('caches', caches)
    await expect(takeSharedText()).resolves.toBeNull()
  })

  it('parses the staged JSON payload and clears the entry', async () => {
    const payload = { text: 'an article', url: 'https://example.com', title: 'Example' }
    const response = new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' },
    })
    const { caches, store } = createFakeCacheStorage({ '/__share/text': response })
    vi.stubGlobal('window', { caches })
    vi.stubGlobal('caches', caches)

    await expect(takeSharedText()).resolves.toEqual(payload)
    expect(store.has('/__share/text')).toBe(false)
  })
})

describe('hasIncomingShareParam', () => {
  it('is true only when ?shared=1 is present', () => {
    vi.stubGlobal('window', { location: { search: '?shared=1' } })
    expect(hasIncomingShareParam()).toBe(true)

    vi.stubGlobal('window', { location: { search: '' } })
    expect(hasIncomingShareParam()).toBe(false)

    vi.stubGlobal('window', { location: { search: '?shared=0' } })
    expect(hasIncomingShareParam()).toBe(false)
  })
})

describe('clearShareParamFromUrl', () => {
  it('strips the shared param while preserving the rest of the URL', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { href: 'https://read.tryjunco.com/?shared=1&foo=bar#frag' },
      history: { replaceState },
    })

    clearShareParamFromUrl()

    expect(replaceState).toHaveBeenCalledWith({}, '', '/?foo=bar#frag')
  })
})
