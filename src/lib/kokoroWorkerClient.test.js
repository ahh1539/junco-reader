import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeWorker {
  static instances = []

  constructor() {
    this.messages = []
    this.terminated = false
    FakeWorker.instances.push(this)
  }

  postMessage(message) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  emit(data) {
    this.onmessage?.({ data })
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  FakeWorker.instances = []
})

describe('loadKokoro', () => {
  it('starts a fresh worker when the user retries a failed load', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const { loadKokoro } = await import('./kokoroWorkerClient.js')

    const firstLoad = loadKokoro({ device: 'webgpu', dtype: 'fp32' })
    const firstWorker = FakeWorker.instances[0]
    expect(firstWorker.messages).toContainEqual({
      type: 'load',
      device: 'webgpu',
      dtype: 'fp32',
    })
    firstWorker.emit({ type: 'load-error', message: 'initialization failed' })
    await expect(firstLoad).rejects.toThrow('initialization failed')

    const retry = loadKokoro({ device: 'webgpu', dtype: 'fp32' })
    const retryWorker = FakeWorker.instances[1]
    expect(firstWorker.terminated).toBe(true)
    expect(retryWorker.messages).toContainEqual({
      type: 'load',
      device: 'webgpu',
      dtype: 'fp32',
    })

    retryWorker.emit({ type: 'ready', device: 'webgpu', dtype: 'fp32' })
    await expect(retry).resolves.toEqual({ device: 'webgpu', dtype: 'fp32' })
  })
})
