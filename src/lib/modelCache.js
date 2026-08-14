/**
 * Model install state + Hugging Face Hub configuration.
 *
 * Natural weights are fetched by the browser from Hugging Face, never from
 * Vercel or a Junco CDN. Transformers.js caches them into the Cache API after
 * the explicit download.
 */

export const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
export const MODEL_VERSION = 'v1'
export const TRANSFORMERS_CACHE = 'transformers-cache'
export const READY_KEY = `jr_model_ready_${MODEL_VERSION}`

/** Approximate full fp32 download size shown before / after device detection. */
export const DEFAULT_DISPLAY_SIZE = '~326 MB'
export const DEFAULT_BYTES = 325_532_232

const HF_ONNX_BASE = `https://huggingface.co/${MODEL_ID}/resolve/main/onnx`

function hubUrl(file) {
  return `${HF_ONNX_BASE}/${file}`
}

/** Transformers.js maps fp32 to this single weight file. */
const MODEL_WEIGHT_URL = hubUrl('model.onnx')

async function cacheHasUrl(url) {
  if (!('caches' in window)) return false
  try {
    const cache = await caches.open(TRANSFORMERS_CACHE)
    return Boolean(await cache.match(url))
  } catch {
    return false
  }
}

export async function isModelCached() {
  let flagged = false
  try {
    flagged = typeof localStorage !== 'undefined' && localStorage.getItem(READY_KEY) === '1'
  } catch {
    /* Blocked storage should not prevent a direct Cache API check. */
  }

  if (await cacheHasUrl(MODEL_WEIGHT_URL)) {
    try {
      localStorage.setItem(READY_KEY, '1')
    } catch {
      /* ignore */
    }
    return true
  }

  if (flagged) {
    try {
      localStorage.removeItem(READY_KEY)
    } catch {
      /* ignore */
    }
  }
  return false
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

function isSafariUa(userAgent, vendor) {
  const ua = userAgent || ''
  const vend = vendor || ''
  const isAppleVendor = vend.indexOf('Apple') > -1
  const notOtherBrowser =
    !ua.match(/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i) &&
    !ua.includes('Chrome') &&
    !ua.includes('Android')
  return isAppleVendor && notOtherBrowser
}

/**
 * Point ORT's WASM glue at jsDelivr so the ~20 MB runtime is not fetched from
 * Vercel. Model weights stay on Hugging Face (Transformers.js default host).
 *
 * WebGPU still needs this WASM module (JSEP/asyncify glue); it is not a CPU
 * model path. Called only from the Kokoro worker after the user opts into Natural.
 *
 * @param {import('@huggingface/transformers').env} env
 * @param {{ userAgent?: string, vendor?: string }} [browser]
 */
export function configureModelSource(env, browser = {}) {
  env.allowLocalModels = false
  env.useBrowserCache = true

  const onnx = env.backends?.onnx
  const version = onnx?.versions?.web
  if (!onnx?.wasm || !version) return

  const prefix = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`
  const safari = isSafariUa(
    browser.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
    browser.vendor ?? (typeof navigator !== 'undefined' ? navigator.vendor : ''),
  )
  onnx.wasm.wasmPaths = safari
    ? {
        mjs: `${prefix}ort-wasm-simd-threaded.mjs`,
        wasm: `${prefix}ort-wasm-simd-threaded.wasm`,
      }
    : {
        mjs: `${prefix}ort-wasm-simd-threaded.asyncify.mjs`,
        wasm: `${prefix}ort-wasm-simd-threaded.asyncify.wasm`,
      }
}
