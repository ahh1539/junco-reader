import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import {
  chooseRuntime,
  clearStaleCompatibilityMode,
  COMPATIBILITY_MODE_KEY,
  getDeviceLabel,
  isNaturalRuntime,
  NATURAL_UNAVAILABLE_HINT,
  NATURAL_CHECKING_HINT,
  NO_SUPPORTED_SPEECH_HINT,
  naturalFailureMessage,
  runtimeFromMeta,
  speechAvailabilityHint,
} from './kokoroEngine.js'

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  }
}

describe('Kokoro runtime policy', () => {
  it('uses full fp32 on WebGPU when a usable adapter exists', async () => {
    const detect = vi.fn(async () => 'webgpu')

    await expect(chooseRuntime({ detect })).resolves.toMatchObject({
      available: true,
      device: 'webgpu',
      dtype: 'fp32',
      note: 'WebGPU / fp32',
    })
    expect(detect).toHaveBeenCalledOnce()
  })

  it('does not offer a WASM/CPU path when WebGPU is missing', async () => {
    const detect = vi.fn(async () => null)

    const runtime = await chooseRuntime({ detect })
    expect(runtime).toMatchObject({
      available: false,
      device: null,
      dtype: null,
      unavailableReason: NATURAL_UNAVAILABLE_HINT,
    })
    expect(isNaturalRuntime(runtime)).toBe(false)
  })

  it('ignores a leftover compatibility-mode key instead of forcing WASM', async () => {
    const storage = memoryStorage()
    storage.setItem(COMPATIBILITY_MODE_KEY, '1')
    const detect = vi.fn(async () => 'webgpu')

    await expect(chooseRuntime({ detect })).resolves.toMatchObject({
      device: 'webgpu',
      dtype: 'fp32',
    })
    expect(storage.getItem(COMPATIBILITY_MODE_KEY)).toBe('1')
    expect(detect).toHaveBeenCalledOnce()
  })

  it('removes the stale compatibility key without throwing on blocked storage', () => {
    const storage = memoryStorage()
    storage.setItem(COMPATIBILITY_MODE_KEY, '1')
    clearStaleCompatibilityMode(storage)
    expect(storage.getItem(COMPATIBILITY_MODE_KEY)).toBeNull()

    const blocked = {
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(() => clearStaleCompatibilityMode(blocked)).not.toThrow()
  })

  it('only accepts worker metadata that actually loaded WebGPU fp32', () => {
    expect(runtimeFromMeta({ device: 'webgpu', dtype: 'fp32' })).toMatchObject({
      device: 'webgpu',
      dtype: 'fp32',
    })
    expect(runtimeFromMeta({ device: 'webgpu', dtype: 'q8' })).toBeNull()
    expect(runtimeFromMeta({ device: 'wasm', dtype: 'q8' })).toBeNull()
    expect(runtimeFromMeta(null)).toBeNull()
  })

  it('labels WebGPU only', () => {
    expect(getDeviceLabel('webgpu')).toBe('WebGPU')
    expect(getDeviceLabel('wasm')).toBeNull()
  })

  it('explains WebGPU failure without offering a silent CPU fallback', () => {
    expect(naturalFailureMessage(new Error('adapter lost'))).toMatch(/no CPU fallback/i)
    expect(naturalFailureMessage(new Error('adapter lost'))).not.toMatch(/built-in speech/i)
  })

  it('starts Natural as unknown until a WebGPU probe resolves', () => {
    expect(NATURAL_CHECKING_HINT).toMatch(/Checking/i)
    expect(NATURAL_UNAVAILABLE_HINT).toMatch(/WebGPU/i)
    expect(NATURAL_UNAVAILABLE_HINT).not.toMatch(/built-in speech/i)
  })

  it('only claims built-in speech still works when Instant is actually usable', () => {
    expect(
      speechAvailabilityHint({ naturalAvailable: false, instantUsable: true, instantResolved: true }),
    ).toMatch(/built-in speech still works/i)
    expect(
      speechAvailabilityHint({ naturalAvailable: false, instantUsable: false, instantResolved: true }),
    ).toBe(NO_SUPPORTED_SPEECH_HINT)
    expect(
      speechAvailabilityHint({ naturalAvailable: false, instantUsable: false, instantResolved: false }),
    ).toBe(NATURAL_UNAVAILABLE_HINT)
    expect(speechAvailabilityHint({ naturalAvailable: true })).toBeNull()
  })
})

describe('Kokoro worker load policy', () => {
  it('does not silently fall back from WebGPU to WASM', () => {
    const src = readFileSync(new URL('./kokoroWorker.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/finalDevice\s*=\s*'wasm'/)
    expect(src).not.toMatch(/load\(\s*'wasm'/)
    expect(src).toMatch(/device !== 'webgpu' \|\| dtype !== 'fp32'/)
  })
})
