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

/** Approximate q8 download size shown before manifest loads. */
export const DEFAULT_DISPLAY_SIZE = '~85 MB'
export const DEFAULT_BYTES = 89_000_000

/**
 * Marker file URL used to detect a prior Cache API install.
 * q8 quantized ONNX is the primary weight file for wasm dtype.
 */
function modelFileUrl() {
  const useCdn = import.meta.env.VITE_USE_CDN === 'true'
  if (useCdn) {
    return `${CDN_BASE}/${MODEL_ID}/onnx/model_quantized.onnx`
  }
  return `https://huggingface.co/${MODEL_ID}/resolve/main/onnx/model_quantized.onnx`
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

export async function isModelCached() {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(READY_KEY) === '1') {
    // Confirm cache still has the weight file when Cache API is available
    if (!('caches' in window)) return true
    try {
      const cache = await caches.open(TRANSFORMERS_CACHE)
      const hit = await cache.match(modelFileUrl())
      if (hit) return true
      // Marker without file: clear stale flag
      localStorage.removeItem(READY_KEY)
      return false
    } catch {
      return true
    }
  }

  if (!('caches' in window)) return false
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE)
    const hit = await cache.match(modelFileUrl())
    if (hit) {
      localStorage.setItem(READY_KEY, '1')
      return true
    }
  } catch {
    /* ignore */
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
 * Point Transformers.js at the Junco CDN when enabled.
 * @param {import('@huggingface/transformers').env} env
 */
export function configureModelSource(env) {
  env.allowLocalModels = false
  env.useBrowserCache = true
  if (import.meta.env.VITE_USE_CDN === 'true') {
    env.remoteHost = `${CDN_BASE}/`
    // Full model id is substituted into {model}
    env.remotePathTemplate = '{model}/'
  }
}
