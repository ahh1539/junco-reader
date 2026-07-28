/**
 * Model install state + CDN / HF configuration.
 *
 * Production path: mirror weights to models.tryjunco.com/kokoro-web/v1/
 * and set VITE_USE_CDN=true. Until then, Hugging Face Hub is the source;
 * Transformers.js still caches into the Cache API after the explicit download.
 */

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const MODEL_VERSION = 'v1'
export const MANIFEST_URL = '/model/manifest.json'
export const CDN_BASE = 'https://models.tryjunco.com/kokoro-web/v1'
export const TRANSFORMERS_CACHE = 'transformers-cache'
export const READY_KEY = `jr_model_ready_${MODEL_VERSION}`

/** Approximate q8 download size shown before device detection. */
export const DEFAULT_DISPLAY_SIZE = '~85 MB'
export const DEFAULT_BYTES = 89_000_000

function hubUrl(file) {
  const useCdn = import.meta.env.VITE_USE_CDN === 'true'
  if (useCdn) return `${CDN_BASE}/${MODEL_ID}/onnx/${file}`
  return `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/${file}`
}

/** Possible primary weight files (fp32 WebGPU vs q8 WASM). */
function candidateWeightUrls() {
  return [
    hubUrl('model.onnx'),
    hubUrl('model_quantized.onnx'),
    hubUrl('model_q8.onnx'),
  ]
}

function weightUrlForDtype(dtype) {
  if (dtype === 'fp32' || dtype === 'fp16') return hubUrl('model.onnx')
  return hubUrl('model_quantized.onnx')
}

export async function loadManifest() {
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-cache' })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function cacheHasUrl(url) {
  if (!('caches' in window)) return false
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE)
    return Boolean(await cache.match(url))
  } catch {
    return false
  }
}

async function cacheHasWeights() {
  for (const url of candidateWeightUrls()) {
    if (await cacheHasUrl(url)) return true
  }
  return false
}

/**
 * @param {{ dtype?: string } | null} [runtime]
 */
export async function isModelCached(runtime = null) {
  const targetUrl = runtime?.dtype
    ? weightUrlForDtype(runtime.dtype)
    : null

  const flagged =
    typeof localStorage !== 'undefined' && localStorage.getItem(READY_KEY) === '1'

  if (targetUrl) {
    const hit = await cacheHasUrl(targetUrl)
    if (hit) {
      localStorage.setItem(READY_KEY, '1')
      return true
    }
    if (flagged) localStorage.removeItem(READY_KEY)
    return false
  }

  if (flagged) {
    if (!('caches' in window)) return true
    const hit = await cacheHasWeights()
    if (hit) return true
    localStorage.removeItem(READY_KEY)
    return false
  }

  if (await cacheHasWeights()) {
    localStorage.setItem(READY_KEY, '1')
    return true
  }
  return false
}

export function markModelReady() {
  try {
    localStorage.setItem(READY_KEY, '1')
  } catch {
    /* ignore */
  }
}

/**
 * Remove cached model weights from this browser and clear the ready flag.
 * Does not touch the user's documents (those are never persisted).
 */
export async function clearModelCache() {
  try {
    localStorage.removeItem(READY_KEY)
  } catch {
    /* ignore */
  }

  if (!('caches' in window)) return

  try {
    const keys = await caches.keys()
    await Promise.all(
      keys
        .filter((name) => {
          const lower = name.toLowerCase()
          return (
            name === TRANSFORMERS_CACHE ||
            lower.includes('transformers') ||
            lower.includes('onnx') ||
            lower.includes('kokoro') ||
            lower.includes('huggingface')
          )
        })
        .map((name) => caches.delete(name)),
    )
  } catch (err) {
    console.warn('Failed to clear model Cache API entries:', err)
    throw err
  }
}

/**
 * Point Transformers.js at the Junco CDN when enabled.
 * @param {import('@huggingface/transformers').env} env
 */
export function configureModelSource(env) {
  env.allowLocalModels = false
  env.useBrowserCache = true
  if (import.meta.env.VITE_USE_CDN === 'true') {
    env.remoteHost = `${CDN_BASE}/`
    env.remotePathTemplate = '{model}/'
  }
}
