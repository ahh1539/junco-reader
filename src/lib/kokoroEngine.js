import { DEFAULT_DISPLAY_SIZE, DEFAULT_BYTES } from './modelCache.js'

export const COMPATIBILITY_MODE_KEY = 'jr_kokoro_compatibility_mode'

const WASM_RUNTIME = {
  device: 'wasm',
  dtype: 'q8',
  displaySize: DEFAULT_DISPLAY_SIZE,
  approximateBytes: DEFAULT_BYTES,
  note: 'WASM',
}

const WEBGPU_RUNTIME = {
  device: 'webgpu',
  dtype: 'fp32',
  displaySize: '~310 MB',
  approximateBytes: 326_000_000,
  note: 'WebGPU (fast)',
}

function getStorage(storage) {
  if (storage !== undefined) return storage
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

/** Read the optional client-only compatibility preference without assuming storage works. */
export function readCompatibilityMode(storage) {
  try {
    return getStorage(storage)?.getItem(COMPATIBILITY_MODE_KEY) === '1'
  } catch {
    return false
  }
}

/** Persist the optional client-only compatibility preference best-effort. */
export function writeCompatibilityMode(enabled, storage) {
  try {
    const target = getStorage(storage)
    if (!target) return
    if (enabled) target.setItem(COMPATIBILITY_MODE_KEY, '1')
    else target.removeItem(COMPATIBILITY_MODE_KEY)
  } catch {
    /* Private browsing and blocked storage must not break playback. */
  }
}

function wasmRuntime() {
  return { ...WASM_RUNTIME }
}

function webgpuRuntime() {
  return { ...WEBGPU_RUNTIME }
}

/**
 * Device/dtype capability detection (main-thread only: navigator.gpu).
 *
 * Model loading and synthesis run in a worker -- see kokoroWorkerClient.js.
 * This module stays main-thread-only so capability detection (used for the
 * download-size UI before any model load starts) doesn't need the worker.
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
  return 'wasm'
}

/**
 * Device/dtype policy (kokoro-js / Transformers.js v4):
 * - WebGPU uses fp32 for the highest-fidelity path.
 * - WASM + q8 is the small-download / lower-RAM compatibility path.
 *
 * Ref: hexgrad/kokoro#98, transformers.js#1320
 */
export async function chooseRuntime({ compatibilityMode = readCompatibilityMode(), detect = detectDevice } = {}) {
  if (compatibilityMode) return wasmRuntime()

  const device = await detect()
  return device === 'webgpu' ? webgpuRuntime() : wasmRuntime()
}

/** Convert worker-reported load metadata into the runtime shown to the user. */
export function runtimeFromMeta(meta) {
  return meta?.device === 'webgpu' && meta?.dtype === 'fp32' ? webgpuRuntime() : wasmRuntime()
}

export function getDeviceLabel(device) {
  return device === 'webgpu' ? 'WebGPU' : 'WASM'
}
