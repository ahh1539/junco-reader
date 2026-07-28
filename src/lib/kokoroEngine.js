import { DEFAULT_DISPLAY_SIZE, DEFAULT_BYTES } from './modelCache.js'

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
 * Device/dtype policy (kokoro-js / transformers.js):
 * - WebGPU + non-fp32 can produce corrupted audio → WebGPU requires fp32.
 * - WASM + q8 is the small-download / lower-RAM path.
 *
 * Ref: hexgrad/kokoro#98, transformers.js#1320
 */
export async function chooseRuntime() {
  const device = await detectDevice()
  if (device === 'webgpu') {
    return {
      device: 'webgpu',
      dtype: 'fp32',
      displaySize: '~310 MB',
      approximateBytes: 326_000_000,
      note: 'WebGPU (fast)',
    }
  }
  return {
    device: 'wasm',
    dtype: 'q8',
    displaySize: DEFAULT_DISPLAY_SIZE,
    approximateBytes: DEFAULT_BYTES,
    note: 'WASM',
  }
}

export function getDeviceLabel(device) {
  return device === 'webgpu' ? 'WebGPU' : 'WASM'
}
