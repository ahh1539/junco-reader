import { describe, expect, it, vi } from 'vitest'

import { synthesizeChunk } from './kokoroWorkerClient.js'
import { JOIN_OVERLAP_SEC, runPipelinedPlayback, trimAndFade } from './playbackPipeline'

vi.mock('./kokoroWorkerClient.js', () => ({ synthesizeChunk: vi.fn() }))

const SR = 24000

function tone(seconds, amplitude = 0.35) {
  const n = Math.floor(seconds * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * amplitude
  return out
}

function noise(seconds, amplitude = 0.005) {
  const n = Math.floor(seconds * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = (Math.random() * 2 - 1) * amplitude
  return out
}

function concat(...parts) {
  const n = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Float32Array(n)
  let o = 0
  for (const part of parts) {
    out.set(part, o)
    o += part.length
  }
  return out
}

describe('trimAndFade', () => {
  it('strips Kokoro-like noisy padding that a -60 dBFS peak trim would keep', () => {
    const samples = concat(noise(0.5, 0.005), tone(0.25), noise(0.4, 0.005))
    const trimmed = trimAndFade(samples, SR)
    const duration = trimmed.length / SR
    expect(duration).toBeLessThan(0.32)
    expect(duration).toBeGreaterThan(0.22)
  })

  it('keeps a speech-only buffer nearly intact', () => {
    const samples = tone(0.4)
    const trimmed = trimAndFade(samples, SR)
    expect(trimmed.length / SR).toBeGreaterThan(0.35)
  })

  it('does not collapse a quiet-but-not-empty clip to nothing', () => {
    const samples = noise(0.2, 0.002)
    const trimmed = trimAndFade(samples, SR)
    expect(trimmed.length).toBeGreaterThan(32)
  })
})

describe('JOIN_OVERLAP_SEC', () => {
  it('is a short crossfade, not a chunk-length overlap', () => {
    expect(JOIN_OVERLAP_SEC).toBeGreaterThan(0.01)
    expect(JOIN_OVERLAP_SEC).toBeLessThan(0.05)
  })
})

describe('runPipelinedPlayback', () => {
  it('stops filling the synthesis buffer while paused', async () => {
    vi.mocked(synthesizeChunk).mockReset()
    let resolveFirst
    vi.mocked(synthesizeChunk)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve
        }),
      )
      .mockResolvedValue({ audio: tone(0.1), sampling_rate: SR })

    const audioCtx = {
      currentTime: 0,
      destination: {},
      createBuffer(_channels, length, sampleRate) {
        return { duration: length / sampleRate, copyToChannel() {} }
      },
      createBufferSource() {
        return {
          playbackRate: { value: 1 },
          connect() {},
          start() {},
          stop() {},
          onended: null,
        }
      },
    }

    const playback = runPipelinedPlayback({
      chunks: ['one', 'two', 'three'],
      voice: 'test',
      audioCtx,
    })
    expect(synthesizeChunk).toHaveBeenCalledTimes(1)

    playback.pause()
    resolveFirst({ audio: tone(0.1), sampling_rate: SR })
    await vi.waitFor(() => expect(synthesizeChunk).toHaveBeenCalledTimes(1))

    playback.resume()
    await vi.waitFor(() => expect(synthesizeChunk).toHaveBeenCalledTimes(3))
    playback.stop()
  })

  it('clock-schedules a short gap after a sentence-ending chunk', async () => {
    vi.mocked(synthesizeChunk).mockReset().mockResolvedValue({ audio: tone(0.1), sampling_rate: SR })
    const sources = []
    const audioCtx = {
      currentTime: 0,
      destination: {},
      createBuffer(_channels, length, sampleRate) {
        return { duration: length / sampleRate, copyToChannel() {} }
      },
      createBufferSource() {
        const source = {
          playbackRate: { value: 1, setValueAtTime(value) { this.value = value } },
          connect() {},
          start(time) { this.startTime = time },
          stop() {},
          onended: null,
        }
        sources.push(source)
        return source
      },
    }

    const playback = runPipelinedPlayback({
      chunks: ['One sentence.', 'The next'],
      voice: 'test',
      audioCtx,
    })
    await vi.waitFor(() => expect(sources).toHaveLength(2))
    expect(sources[0].startTime).toBe(0)
    expect(sources[1].startTime).toBeCloseTo(0.22, 3)

    sources[0].onended()
    sources[1].onended()
    await expect(playback.done).resolves.toMatchObject({ chunksDone: 2 })
  })

  it('does not finish while the final chunk is still synthesizing', async () => {
    vi.mocked(synthesizeChunk).mockReset()
    let resolveFinal
    const finalAudio = new Promise((resolve) => {
      resolveFinal = resolve
    })
    vi.mocked(synthesizeChunk)
      .mockResolvedValueOnce({ audio: tone(0.1), sampling_rate: SR })
      .mockReturnValueOnce(finalAudio)

    const sources = []
    const audioCtx = {
      currentTime: 0,
      destination: {},
      createBuffer(_channels, length, sampleRate) {
        return {
          duration: length / sampleRate,
          copyToChannel() {},
        }
      },
      createBufferSource() {
        const source = {
          buffer: null,
          playbackRate: { value: 1, setValueAtTime(value) { this.value = value } },
          connect() {},
          start() {},
          stop() {},
          onended: null,
        }
        sources.push(source)
        return source
      },
    }

    const playback = runPipelinedPlayback({
      chunks: ['first', 'second'],
      voice: 'test',
      audioCtx,
    })
    await vi.waitFor(() => expect(sources).toHaveLength(1))

    let settled = false
    playback.done.then(() => {
      settled = true
    })
    sources[0].onended()
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveFinal({ audio: tone(0.1), sampling_rate: SR })
    await vi.waitFor(() => expect(sources).toHaveLength(2))
    sources[1].onended()

    await expect(playback.done).resolves.toMatchObject({ chunksDone: 2 })
  })

  it('keeps future audio on the clock when speed changes during a sentence gap', async () => {
    vi.mocked(synthesizeChunk).mockReset().mockResolvedValue({ audio: tone(0.1), sampling_rate: SR })
    const sources = []
    const audioCtx = {
      currentTime: 0,
      destination: {},
      createBuffer(_channels, length, sampleRate) {
        return { duration: length / sampleRate, copyToChannel() {} }
      },
      createBufferSource() {
        const source = {
          playbackRate: { value: 1 },
          connect() {},
          start(time) { this.startTime = time },
          stop() {},
          onended: null,
        }
        sources.push(source)
        return source
      },
    }

    const playback = runPipelinedPlayback({
      chunks: ['First sentence.', 'technical join', 'third chunk'],
      voice: 'test',
      audioCtx,
    })
    await vi.waitFor(() => expect(sources).toHaveLength(2))

    audioCtx.currentTime = 0.1
    sources[0].onended()
    await vi.waitFor(() => expect(sources).toHaveLength(3))
    expect(sources[1].startTime).toBeCloseTo(0.22, 3)

    playback.setSpeed(2)
    expect(sources).toHaveLength(4)
    expect(sources[3].startTime).toBeCloseTo(0.26, 3)

    sources[1].onended()
    sources[3].onended()
    await expect(playback.done).resolves.toMatchObject({ chunksDone: 3 })
  })
})
