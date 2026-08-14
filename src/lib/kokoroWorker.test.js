import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fromPretrained: vi.fn(),
}))

vi.mock('kokoro-js', () => ({
  KokoroTTS: { from_pretrained: mocks.fromPretrained },
}))
vi.mock('@huggingface/transformers', () => ({
  env: { backends: {} },
}))

beforeEach(() => {
  vi.resetModules()
  mocks.fromPretrained.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Kokoro worker generation queue', () => {
  it('serializes model generate calls', async () => {
    let resolveFirst
    const generate = vi
      .fn()
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValue({ audio: new Float32Array([0.2]), sampling_rate: 24000 })
    mocks.fromPretrained.mockResolvedValue({ generate })

    const workerScope = { postMessage: vi.fn(), onmessage: null }
    vi.stubGlobal('self', workerScope)
    await import('./kokoroWorker.js')

    await workerScope.onmessage({ data: { type: 'load', device: 'webgpu', dtype: 'fp32' } })
    const first = workerScope.onmessage({
      data: { type: 'synthesize', id: 1, text: 'first', voice: 'af_heart' },
    })
    const second = workerScope.onmessage({
      data: { type: 'synthesize', id: 2, text: 'second', voice: 'af_heart' },
    })

    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    resolveFirst({ audio: new Float32Array([0.1]), sampling_rate: 24000 })
    await Promise.all([first, second])

    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls.map(([text]) => text)).toEqual(['first', 'second'])
    expect(workerScope.postMessage.mock.calls.map(([message]) => message.type)).toContain('result')
  })
})
