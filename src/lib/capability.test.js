import { afterEach, describe, expect, it, vi } from 'vitest'

import { getCapabilityMessage, hasWebGPU } from './capability.js'

function stubNavigator({ ua = 'Mozilla/5.0', gpu = undefined } = {}) {
  vi.stubGlobal('navigator', {
    userAgent: ua,
    gpu,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('hasWebGPU', () => {
  it('is false without navigator.gpu', async () => {
    stubNavigator({ gpu: undefined })
    await expect(hasWebGPU()).resolves.toBe(false)
  })

  it('is true only when requestAdapter returns an adapter', async () => {
    stubNavigator({
      gpu: { requestAdapter: vi.fn(async () => ({ name: 'fake' })) },
    })
    await expect(hasWebGPU()).resolves.toBe(true)
  })
})

describe('getCapabilityMessage', () => {
  it('accepts an existing WebGPU result without probing the adapter again', async () => {
    const requestAdapter = vi.fn()
    stubNavigator({ gpu: { requestAdapter } })

    await expect(getCapabilityMessage({ webgpu: true })).resolves.toBeNull()
    expect(requestAdapter).not.toHaveBeenCalled()
  })

  it('explains Natural is unavailable without WebGPU without claiming Instant works', async () => {
    stubNavigator({ ua: 'Mozilla/5.0 (Macintosh)', gpu: undefined })
    const message = await getCapabilityMessage()
    expect(message).toMatch(/WebGPU/i)
    expect(message).not.toMatch(/built-in speech/i)
    expect(message).not.toMatch(/WASM/i)
  })
})
