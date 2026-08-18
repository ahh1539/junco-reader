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
/** @type {Map<string, { resolve: Function, reject: Function, promise: Promise<void> }>} */
const warmupWaiters = new Map()

/** Bound for warmup/synthesize. A stall terminates the worker so the queue can recover. */
export const WORKER_RPC_TIMEOUT_MS = 45_000

export const WORKER_STALL_MESSAGE =
  'Natural voice stalled and was reset. Press Listen to try again.'

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
      const current = warmupWaiters.get(msg.voice)
      if (!current) return
      warmupWaiters.delete(msg.voice)
      if (msg.error) current.reject(new Error(msg.error))
      else {
        warmedVoice = msg.voice
        current.resolve()
      }
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
    failWorker(new Error(event.message || 'Kokoro worker error'))
  }
  return worker
}

const progressListeners = new Set()

function failWorker(err) {
  const error = err instanceof Error ? err : new Error(String(err || 'Kokoro worker error'))
  if (worker) {
    worker.onmessage = null
    worker.onerror = null
    worker.terminate()
    worker = null
  }
  loadResult = null
  loadError = error
  warmedVoice = null
  warmupWaiters.forEach((waiter) => waiter.reject(error))
  warmupWaiters.clear()
  loadWaiters.forEach((w) => w.reject(error))
  loadWaiters = []
  pending.forEach((p) => p.reject(error))
  pending.clear()
  progressListeners.clear()
}

function withTimeout(promise, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      failWorker(new Error(message))
      reject(new Error(message))
    }, WORKER_RPC_TIMEOUT_MS)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

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
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.terminate()
      worker = null
    }
    loadError = null
    warmedVoice = null
    warmupWaiters.forEach((waiter) => waiter.reject(new Error('Kokoro worker reset')))
    warmupWaiters.clear()
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
  failWorker(new Error('Kokoro worker unloaded'))
  loadError = null
}

/** Rejects on worker error or stall. Does not latch the voice until success. */
export function warmUp(voice) {
  if (!worker || !loadResult || warmedVoice === voice) return Promise.resolve()
  const existing = warmupWaiters.get(voice)
  if (existing) return existing.promise

  let resolve
  let reject
  const inner = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  const promise = withTimeout(inner, WORKER_STALL_MESSAGE)
  warmupWaiters.set(voice, { resolve, reject, promise })
  worker.postMessage({ type: 'warmup', voice })
  return promise
}

/**
 * Synthesize one chunk. Returns transferred (zero-copy) Float32Array PCM.
 * @param {string} text
 * @param {{ voice: string }} options
 */
export function synthesizeChunk(text, { voice }) {
  const w = ensureWorker()
  const id = nextRequestId++
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    w.postMessage({ type: 'synthesize', id, text, voice })
  })
  return withTimeout(promise, WORKER_STALL_MESSAGE)
}
