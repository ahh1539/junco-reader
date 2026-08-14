import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  configureModelSource,
  DEFAULT_BYTES,
  DEFAULT_DISPLAY_SIZE,
  isModelCached,
  READY_KEY,
} from './modelCache.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Natural model source', () => {
  it('advertises the full fp32 download size', () => {
    expect(DEFAULT_DISPLAY_SIZE).toBe('~326 MB')
    expect(DEFAULT_BYTES).toBe(325_532_232)
  })

  it('checks and caches the full model.onnx rather than quantized weights', () => {
    const src = readFileSync(new URL('./modelCache.js', import.meta.url), 'utf8')
    expect(src).toMatch(/hubUrl\('model\.onnx'\)/)
    expect(src).not.toMatch(/model_quantized\.onnx|model_q8\.onnx/)
  })

  it('recognizes the full fp32 weight in Cache Storage and records the fast-path hint', async () => {
    const storage = memoryStorage()
    const match = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { caches: {} })
    vi.stubGlobal('caches', { open: vi.fn(async () => ({ match })) })
    vi.stubGlobal('localStorage', storage)

    await expect(isModelCached()).resolves.toBe(true)
    expect(match).toHaveBeenCalledWith(
      'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/onnx/model.onnx',
    )
    expect(storage.getItem(READY_KEY)).toBe('1')
  })

  it('clears a stale ready hint when the fp32 weight is missing', async () => {
    const storage = memoryStorage({ [READY_KEY]: '1' })
    vi.stubGlobal('window', { caches: {} })
    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({ match: vi.fn(async () => undefined) })),
    })
    vi.stubGlobal('localStorage', storage)

    await expect(isModelCached()).resolves.toBe(false)
    expect(storage.getItem(READY_KEY)).toBeNull()
  })

  it('points ORT WASM at jsDelivr instead of the app origin', () => {
    const env = {
      backends: {
        onnx: {
          versions: { web: '1.26.0-dev.example' },
          wasm: { wasmPaths: { wasm: '/assets/ort-wasm-from-vite.wasm' } },
        },
      },
    }

    configureModelSource(env, {
      userAgent: 'Mozilla/5.0 Chrome/120',
      vendor: 'Google Inc.',
    })

    expect(env.allowLocalModels).toBe(false)
    expect(env.backends.onnx.wasm.wasmPaths.wasm).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web@1\.26\.0-dev\.example\/dist\/ort-wasm-simd-threaded\.asyncify\.wasm$/,
    )
    expect(env.backends.onnx.wasm.wasmPaths.wasm).not.toMatch(/\/assets\//)
  })

  it('does not set a Junco or Vercel host for model weights', () => {
    const env = {
      backends: {
        onnx: {
          versions: { web: '1.26.0-dev.example' },
          wasm: {},
        },
      },
    }
    configureModelSource(env, { userAgent: 'Mozilla/5.0 Chrome/120', vendor: 'Google Inc.' })
    expect(env.remoteHost).toBeUndefined()
  })
})
