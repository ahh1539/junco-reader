import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MODEL_ID } from './modelCache.js'
import {
  ensureVoiceBinCached,
  KOKORO_VOICES_CACHE,
  kokoroVoiceBinUrl,
  VOICE_BIN_MIN_BYTES,
} from './kokoroVoices.js'

function validBin(fill = 7) {
  return new Uint8Array(VOICE_BIN_MIN_BYTES).fill(fill).buffer
}

function memoryCache() {
  const entries = new Map()
  return {
    match: vi.fn(async (url) => entries.get(String(url)) ?? undefined),
    put: vi.fn(async (url, response) => {
      entries.set(String(url), response)
    }),
    entries,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('kokoro voice bins', () => {
  it('uses the same Hub URL template as kokoro-js', () => {
    const src = readFileSync(new URL('../../node_modules/kokoro-js/dist/kokoro.js', import.meta.url), 'utf8')
    const url = kokoroVoiceBinUrl('af_bella')
    expect(url).toBe(`https://huggingface.co/${MODEL_ID}/resolve/main/voices/af_bella.bin`)
    expect(src).toContain(`https://huggingface.co/${MODEL_ID}/resolve/main/voices/\${e}.bin`)
  })

  it('downloads a missing voice bin into the kokoro-voices cache', async () => {
    const cache = memoryCache()
    const body = validBin(1)
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'application/octet-stream' } }))
    const cachesImpl = {
      open: vi.fn(async (name) => {
        expect(name).toBe(KOKORO_VOICES_CACHE)
        return cache
      }),
    }

    const url = await ensureVoiceBinCached('af_nicole', { fetchImpl, cachesImpl })
    expect(url).toBe(kokoroVoiceBinUrl('af_nicole'))
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(cache.put).toHaveBeenCalledOnce()
    expect((await (await cache.match(url)).arrayBuffer()).byteLength).toBe(VOICE_BIN_MIN_BYTES)
  })

  it('does not refetch when a usable bin is already cached', async () => {
    const cache = memoryCache()
    const url = kokoroVoiceBinUrl('am_michael')
    await cache.put(url, new Response(validBin(9)))
    const fetchImpl = vi.fn()
    const cachesImpl = { open: async () => cache }

    await expect(ensureVoiceBinCached('am_michael', { fetchImpl, cachesImpl })).resolves.toBe(url)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refetches when a cached entry is too small to be a voice embedding', async () => {
    const cache = memoryCache()
    const url = kokoroVoiceBinUrl('af_bella')
    await cache.put(url, new Response(new Uint8Array([1, 2, 3]).buffer))
    const fetchImpl = vi.fn(async () => new Response(validBin(4), { status: 200 }))
    const cachesImpl = { open: async () => cache }

    await ensureVoiceBinCached('af_bella', { fetchImpl, cachesImpl })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('throws when the Hub response is not ok', async () => {
    const cache = memoryCache()
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 }))
    const cachesImpl = { open: async () => cache }

    await expect(ensureVoiceBinCached('af_bella', { fetchImpl, cachesImpl })).rejects.toThrow(/af_bella/)
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('dedupes concurrent downloads of the same voice', async () => {
    const cache = memoryCache()
    let release
    const fetchImpl = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const cachesImpl = { open: async () => cache }

    const first = ensureVoiceBinCached('bf_emma', { fetchImpl, cachesImpl })
    const second = ensureVoiceBinCached('bf_emma', { fetchImpl, cachesImpl })
    expect(first).toBe(second)
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    release(new Response(validBin(2), { status: 200 }))
    await expect(first).resolves.toBe(kokoroVoiceBinUrl('bf_emma'))
    await second
  })

  it('times out a hung fetch', async () => {
    vi.useFakeTimers()
    const cache = memoryCache()
    const fetchImpl = vi.fn(() => new Promise(() => {}))
    const cachesImpl = { open: async () => cache }
    const pending = ensureVoiceBinCached('af_bella', {
      fetchImpl,
      cachesImpl,
      timeoutMs: 1_000,
    })
    const assertion = expect(pending).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it('times out if headers return but the body never arrives', async () => {
    vi.useFakeTimers()
    const cache = memoryCache()
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: () => new Promise(() => {}),
    }))
    const cachesImpl = { open: async () => cache }
    const pending = ensureVoiceBinCached('af_nicole', {
      fetchImpl,
      cachesImpl,
      timeoutMs: 1_000,
    })
    const assertion = expect(pending).rejects.toThrow(/timed out/i)
    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })
})
