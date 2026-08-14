import { DEFAULT_BYTES, DEFAULT_DISPLAY_SIZE } from './modelCache.js'

/** Legacy key from the removed WASM compatibility path. Must not force a runtime. */
export const COMPATIBILITY_MODE_KEY = 'jr_kokoro_compatibility_mode'

export const NATURAL_CHECKING_HINT = 'Checking whether Natural voice can run here…'

export const NATURAL_UNAVAILABLE_HINT =
  'Natural voice needs WebGPU. Use a current desktop browser with hardware acceleration enabled.'

export const NO_SUPPORTED_SPEECH_HINT =
  'This browser has no usable speech here. Natural needs WebGPU, and Instant needs a local browser voice.'

const WEBGPU_RUNTIME = {
  available: true,
  device: 'webgpu',
  dtype: 'fp32',
  displaySize: DEFAULT_DISPLAY_SIZE,
  approximateBytes: DEFAULT_BYTES,
  note: 'WebGPU / fp32',
}

const UNAVAILABLE_RUNTIME = {
  available: false,
  device: null,
  dtype: null,
  displaySize: DEFAULT_DISPLAY_SIZE,
  approximateBytes: DEFAULT_BYTES,
  note: null,
  unavailableReason: NATURAL_UNAVAILABLE_HINT,
}

function getStorage(storage) {
  if (storage !== undefined) return storage
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/**
 * Drop the old compatibility-mode flag so a leftover `1` cannot steer runtime
 * selection. Safe if storage is missing or blocked.
 */
export function clearStaleCompatibilityMode(storage) {
  try {
    getStorage(storage)?.removeItem(COMPATIBILITY_MODE_KEY)
  } catch {
    /* Private browsing and blocked storage must not break playback. */
  }
}

function webgpuRuntime() {
  return { ...WEBGPU_RUNTIME }
}

function unavailableRuntime() {
  return { ...UNAVAILABLE_RUNTIME }
}

export function isNaturalRuntime(runtime) {
  return runtime?.device === 'webgpu' && runtime?.dtype === 'fp32'
}

/**
 * Device capability detection (main-thread only: navigator.gpu).
 *
 * Model loading and synthesis run in a worker -- see kokoroWorkerClient.js.
 * This module stays main-thread-only so the download-size UI can probe
 * WebGPU before any model load starts.
 */
export async function detectDevice() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter()
      if (adapter) return 'webgpu'
    } catch {
      /* fall through */
    }
  }
  return null
}

/**
 * Natural voice is WebGPU + full fp32 only. There is no CPU/WASM path.
 * A leftover compatibility-mode key is ignored (and should be cleared on boot).
 */
export async function chooseRuntime({ detect = detectDevice } = {}) {
  const device = await detect()
  return device === 'webgpu' ? webgpuRuntime() : unavailableRuntime()
}

/** Convert worker-reported load metadata into the runtime shown to the user. */
export function runtimeFromMeta(meta) {
  return isNaturalRuntime(meta) ? webgpuRuntime() : null
}

export function getDeviceLabel(device) {
  return device === 'webgpu' ? 'WebGPU' : null
}

/** Concise copy when WebGPU load or synthesis fails. No silent WASM fallback. */
export function naturalFailureMessage(err) {
  const detail = (err?.message || String(err || '')).trim()
  const short = detail.length > 140 ? `${detail.slice(0, 137)}...` : detail
  if (!short) {
    return "Natural voice failed on WebGPU. There's no CPU fallback."
  }
  return `Natural voice failed on WebGPU (${short}). There's no CPU fallback.`
}

/**
 * Contextual Natural/Instant copy. Never claims built-in speech works unless
 * Instant is actually usable.
 */
export function speechAvailabilityHint({
  naturalAvailable,
  instantUsable = false,
  instantResolved = false,
} = {}) {
  if (naturalAvailable === true) return null
  if (naturalAvailable == null) return NATURAL_CHECKING_HINT
  if (instantResolved && !instantUsable) return NO_SUPPORTED_SPEECH_HINT
  if (instantUsable) return `${NATURAL_UNAVAILABLE_HINT} Built-in speech still works.`
  return NATURAL_UNAVAILABLE_HINT
}
