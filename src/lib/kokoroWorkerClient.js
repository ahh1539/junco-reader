/**
 * Main-thread RPC client for kokoroWorker.js.
 *
 * Keeps the main thread free to schedule AudioBufferSourceNodes on time:
 * phonemization, tokenization, and ONNX inference all happen off-thread.
 */

let worker = null
let nextRequestId = 1
const pending = new Map() // id -> { resolve, reject }
let loadResult = null // { device, dtype } once 'ready' seen
let loadWaiters = []
let loadError = null
let warmedVoice = null

function ensureWorker() {
  if (worker) return worker
  worker = new Worker(new URL('./kokoroWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    const msg = event.data || {}

    if (msg.type === 'progress') {
      progressListeners.forEach((fn) => fn(msg.info))
      return
    }

    if (msg.type === 'ready') {
      loadResult = { device: msg.device, dtype: msg.dtype }
      loadError = null
      loadWaiters.forEach((w) => w.resolve(loadResult))
      loadWaiters = []
      progressListeners.clear()
      return
    }

    if (msg.type === 'load-error') {
      loadError = new Error(msg.message)
      loadWaiters.forEach((w) => w.reject(loadError))
      loadWaiters = []
      progressListeners.clear()
      return
    }

    if (msg.type === 'warmup-done') {
      warmupListeners.forEach((fn) => fn(msg))
      return
    }

    if (msg.type === 'prefetch-done') {
      prefetchListeners.forEach((fn) => fn(msg))
      return
    }

    if (msg.type === 'result') {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        p.resolve({ audio: msg.audio, sampling_rate: msg.sampling_rate })
      }
      return
    }

    if (msg.type === 'error') {
      const p = pending.get(msg.id)
      if (p) {
        pending.delete(msg.id)
        p.reject(new Error(msg.message))
      }
    }
  }
  worker.onerror = (event) => {
    const err = new Error(event.message || 'Kokoro worker error')
    if (!loadResult) {
      loadError = err
      loadWaiters.forEach((w) => w.reject(err))
      loadWaiters = []
    }
    pending.forEach((p) => p.reject(err))
    pending.clear()
  }
  return worker
}

const progressListeners = new Set()
const warmupListeners = new Set()
const prefetchListeners = new Set()

/**
 * Load the model in the worker. Resolves with the device/dtype the worker
 * loaded (WebGPU + fp32). Failures are not retried as WASM — the caller should
 * surface the error and offer built-in speech.
 * @param {{ device: string, dtype: string, onProgress?: (info: object) => void }} opts
 */
export function loadKokoro(opts) {
  if (loadResult) return Promise.resolve(loadResult)

  // A failed worker/model initialization is not recoverable in place. Start a
  // fresh worker on an explicit retry instead of replaying the latched error
  // forever until the caller happens to invoke unloadKokoro().
  if (loadError && loadWaiters.length === 0) {
    worker?.terminate()
    worker = null
    loadError = null
    warmedVoice = null
  }

  const w = ensureWorker()
  if (opts.onProgress) progressListeners.add(opts.onProgress)

  if (loadWaiters.length === 0 && !loadError) {
    w.postMessage({ type: 'load', device: opts.device, dtype: opts.dtype })
  }

  return new Promise((resolve, reject) => {
    if (loadResult) return resolve(loadResult)
    if (loadError) return reject(loadError)
    loadWaiters.push({ resolve, reject })
  })
}

export function isEngineLoading() {
  return Boolean(worker) && !loadResult
}

export function getLoadedMeta() {
  return loadResult || { device: null, dtype: null }
}

/** Drop the worker (and its in-memory model) so the next load starts fresh. */
export function unloadKokoro() {
  if (worker) {
    worker.terminate()
    worker = null
  }
  loadResult = null
  loadError = null
  warmedVoice = null
  loadWaiters = []
  pending.forEach((p) => p.reject(new Error('Kokoro worker unloaded')))
  pending.clear()
}

/** Best-effort; never throws. */
export function warmUp(voice) {
  if (!worker || !loadResult || warmedVoice === voice) return Promise.resolve()
  warmedVoice = voice
  return new Promise((resolve) => {
    const onDone = (msg) => {
      if (msg.voice !== voice) return
      warmupListeners.delete(onDone)
      resolve()
    }
    warmupListeners.add(onDone)
    worker.postMessage({ type: 'warmup', voice })
  })
}

/** Fire-and-forget voice asset prefetch; safe to call speculatively. */
export function prefetchVoice(voice) {
  if (!worker || !loadResult) return
  worker.postMessage({ type: 'prefetch-voice', voice })
}

/**
 * Synthesize one chunk. Returns transferred (zero-copy) Float32Array PCM.
 * @param {string} text
 * @param {{ voice: string }} options
 */
export function synthesizeChunk(text, { voice }) {
  const w = ensureWorker()
  const id = nextRequestId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ type: 'synthesize', id, text, voice })
  })
}
