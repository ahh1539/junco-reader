/**
 * Kokoro style embeddings live in small per-voice .bin files on the Hub.
 * kokoro-js loads them inside generate() via Cache API `kokoro-voices`.
 *
 * Populate the shared Cache from the main thread before the worker's first
 * generate() for that voice, so kokoro-js can cache.match the embedding
 * instead of mixing a Hub fetch into the serialized WebGPU queue.
 */

import { MODEL_ID } from './modelCache.js'

export const KOKORO_VOICES_CACHE = 'kokoro-voices'
export const VOICE_BIN_TIMEOUT_MS = 20_000
/** Hub files are 522,240 bytes; reject HTML/truncated stand-ins. */
export const VOICE_BIN_MIN_BYTES = 100_000
export const VOICE_BIN_MAX_BYTES = 2_000_000

/** Must match kokoro-js getVoiceData. */
export function kokoroVoiceBinUrl(voiceId) {
  return `https://huggingface.co/${MODEL_ID}/resolve/main/voices/${voiceId}.bin`
}

const inflight = new Map()

function getCaches(cachesImpl) {
  if (cachesImpl !== undefined) return cachesImpl
  if (typeof caches !== 'undefined') return caches
  return null
}

function isUsableVoiceBin(buffer) {
  const n = buffer?.byteLength ?? 0
  return n >= VOICE_BIN_MIN_BYTES && n <= VOICE_BIN_MAX_BYTES
}

async function cachedVoiceBuffer(cache, url) {
  const hit = await cache.match(url)
  if (!hit) return null
  try {
    const buffer = await hit.arrayBuffer()
    return isUsableVoiceBin(buffer) ? buffer : null
  } catch {
    return null
  }
}

function timeoutError(voiceId) {
  return new Error(`Timed out downloading the “${voiceId}” voice.`)
}

async function downloadVoiceBody(fetchImpl, url, timeoutMs, voiceId) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl?.abort()
      reject(timeoutError(voiceId))
    }, timeoutMs)
  })
  try {
    const res = await Promise.race([
      fetchImpl(url, ctrl ? { signal: ctrl.signal } : {}),
      deadline,
    ])
    if (!res || typeof res.arrayBuffer !== 'function') {
      throw new Error(`Could not download the “${voiceId}” voice.`)
    }
    if (!res.ok) {
      throw new Error(`Could not download the “${voiceId}” voice (${res.status}).`)
    }
    return await Promise.race([res.arrayBuffer(), deadline])
  } catch (err) {
    if (err?.name === 'AbortError') throw timeoutError(voiceId)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function downloadAndStore(voiceId, { fetchImpl, cachesImpl, timeoutMs }) {
  const store = getCaches(cachesImpl)
  if (!store?.open) throw new Error('Voice files cannot be cached in this browser.')

  const url = kokoroVoiceBinUrl(voiceId)
  const cache = await store.open(KOKORO_VOICES_CACHE)
  if (await cachedVoiceBuffer(cache, url)) return url

  const buffer = await downloadVoiceBody(fetchImpl, url, timeoutMs, voiceId)
  if (!isUsableVoiceBin(buffer)) {
    throw new Error(`The “${voiceId}” voice file was unusable (${buffer.byteLength} bytes).`)
  }
  await cache.put(url, new Response(buffer))
  return url
}

/**
 * Ensure kokoro-js will find this voice in Cache Storage (cache.match hit)
 * and will not network-fetch from the worker.
 * @param {string} voiceId
 * @param {{ fetchImpl?: typeof fetch, cachesImpl?: CacheStorage, timeoutMs?: number }} [opts]
 */
export function ensureVoiceBinCached(
  voiceId,
  { fetchImpl = fetch, cachesImpl, timeoutMs = VOICE_BIN_TIMEOUT_MS } = {},
) {
  const existing = inflight.get(voiceId)
  if (existing) return existing

  const pending = downloadAndStore(voiceId, { fetchImpl, cachesImpl, timeoutMs }).finally(() => {
    if (inflight.get(voiceId) === pending) inflight.delete(voiceId)
  })
  inflight.set(voiceId, pending)
  return pending
}
