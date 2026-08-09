import { describe, expect, it, vi } from 'vitest'

import {
  chooseRuntime,
  COMPATIBILITY_MODE_KEY,
  readCompatibilityMode,
  runtimeFromMeta,
  writeCompatibilityMode,
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
  it('uses WebGPU fp32 when auto mode detects WebGPU', async () => {
    const detect = vi.fn(async () => 'webgpu')

    await expect(chooseRuntime({ detect })).resolves.toMatchObject({
      device: 'webgpu',
      dtype: 'fp32',
      note: 'WebGPU (fast)',
    })
    expect(detect).toHaveBeenCalledOnce()
  })

  it('uses WASM q8 when auto mode cannot detect WebGPU', async () => {
    const detect = vi.fn(async () => 'wasm')

    await expect(chooseRuntime({ detect })).resolves.toMatchObject({
      device: 'wasm',
      dtype: 'q8',
      note: 'WASM',
    })
  })

  it('forces WASM q8 compatibility mode without probing WebGPU', async () => {
    const detect = vi.fn(async () => 'webgpu')

    await expect(chooseRuntime({ compatibilityMode: true, detect })).resolves.toMatchObject({
      device: 'wasm',
      dtype: 'q8',
    })
    expect(detect).not.toHaveBeenCalled()
  })

  it('persists and safely reads the compatibility preference', () => {
    const storage = memoryStorage()

    expect(readCompatibilityMode(storage)).toBe(false)
    writeCompatibilityMode(true, storage)
    expect(storage.getItem(COMPATIBILITY_MODE_KEY)).toBe('1')
    expect(readCompatibilityMode(storage)).toBe(true)
    writeCompatibilityMode(false, storage)
    expect(readCompatibilityMode(storage)).toBe(false)
  })

  it('does not let blocked storage break the preference helpers', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }

    expect(readCompatibilityMode(blocked)).toBe(false)
    expect(() => writeCompatibilityMode(true, blocked)).not.toThrow()
  })

  it('maps worker metadata to the actual loaded runtime', () => {
    expect(runtimeFromMeta({ device: 'webgpu', dtype: 'fp32' })).toMatchObject({
      device: 'webgpu',
      dtype: 'fp32',
    })
    expect(runtimeFromMeta({ device: 'wasm', dtype: 'q8' })).toMatchObject({
      device: 'wasm',
      dtype: 'q8',
    })
  })
})
