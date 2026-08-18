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
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
  FakeWorker.instances = []
})

async function readyClient() {
  vi.stubGlobal('Worker', FakeWorker)
  const client = await import('./kokoroWorkerClient.js')
  const loading = client.loadKokoro({ device: 'webgpu', dtype: 'fp32' })
  FakeWorker.instances[0].emit({ type: 'ready', device: 'webgpu', dtype: 'fp32' })
  await loading
  return client
}

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

describe('warmUp', () => {
  it('does not skip a second call until the worker reports success', async () => {
    const { warmUp } = await readyClient()

    const first = warmUp('af_bella')
    const second = warmUp('af_bella')
    const warmupPosts = FakeWorker.instances[0].messages.filter((m) => m.type === 'warmup')
    expect(warmupPosts).toHaveLength(1)
    expect(first).toBe(second)

    FakeWorker.instances[0].emit({ type: 'warmup-done', voice: 'af_bella' })
    await first
    await second

    await warmUp('af_bella')
    expect(FakeWorker.instances[0].messages.filter((m) => m.type === 'warmup')).toHaveLength(1)
  })

  it('rejects warmup so callers can surface a failed voice', async () => {
    const { warmUp } = await readyClient()

    const failed = warmUp('af_nicole')
    FakeWorker.instances[0].emit({ type: 'warmup-done', voice: 'af_nicole', error: 'style load failed' })
    await expect(failed).rejects.toThrow('style load failed')

    const retry = warmUp('af_nicole')
    expect(FakeWorker.instances[0].messages.filter((m) => m.type === 'warmup')).toHaveLength(2)
    FakeWorker.instances[0].emit({ type: 'warmup-done', voice: 'af_nicole' })
    await retry
  })

  it('keeps overlapping warmups for different voices independent', async () => {
    const { warmUp } = await readyClient()
    const bella = warmUp('af_bella')
    const nicole = warmUp('af_nicole')
    const posts = FakeWorker.instances[0].messages.filter((m) => m.type === 'warmup')
    expect(posts).toEqual([
      { type: 'warmup', voice: 'af_bella' },
      { type: 'warmup', voice: 'af_nicole' },
    ])
    FakeWorker.instances[0].emit({ type: 'warmup-done', voice: 'af_bella' })
    await bella
    await expect(Promise.race([nicole, Promise.resolve('still-pending')])).resolves.toBe('still-pending')
    FakeWorker.instances[0].emit({ type: 'warmup-done', voice: 'af_nicole' })
    await nicole
  })

  it('rejects in-flight warmup when the worker is unloaded', async () => {
    const { warmUp, unloadKokoro } = await readyClient()
    const pending = warmUp('am_michael')
    unloadKokoro()
    await expect(pending).rejects.toThrow(/unloaded/)
  })

  it('terminates a stalled worker so later playback can start a fresh one', async () => {
    vi.useFakeTimers()
    const { warmUp, WORKER_RPC_TIMEOUT_MS, WORKER_STALL_MESSAGE, loadKokoro } = await readyClient()
    const firstWorker = FakeWorker.instances[0]
    const stalled = warmUp('af_bella')
    const assertion = expect(stalled).rejects.toThrow(WORKER_STALL_MESSAGE)
    await vi.advanceTimersByTimeAsync(WORKER_RPC_TIMEOUT_MS)
    await assertion
    expect(firstWorker.terminated).toBe(true)

    const retry = loadKokoro({ device: 'webgpu', dtype: 'fp32' })
    expect(FakeWorker.instances[1]).toBeTruthy()
    FakeWorker.instances[1].emit({ type: 'ready', device: 'webgpu', dtype: 'fp32' })
    await expect(retry).resolves.toEqual({ device: 'webgpu', dtype: 'fp32' })
  })
})

describe('synthesizeChunk', () => {
  it('resets the worker when a generate call never returns', async () => {
    vi.useFakeTimers()
    const { synthesizeChunk, WORKER_RPC_TIMEOUT_MS, WORKER_STALL_MESSAGE } = await readyClient()
    const worker = FakeWorker.instances[0]
    const pending = synthesizeChunk('Hello.', { voice: 'af_bella' })
    const assertion = expect(pending).rejects.toThrow(WORKER_STALL_MESSAGE)
    await vi.advanceTimersByTimeAsync(WORKER_RPC_TIMEOUT_MS)
    await assertion
    expect(worker.terminated).toBe(true)
  })
})
