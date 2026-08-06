import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetVoiceCacheForTests,
  getWebSpeechVoices,
  isWebSpeechSupported,
  preferredDefaultVoice,
  runWebSpeechPlayback,
} from './webSpeechEngine'

class FakeUtterance {
  constructor(text) {
    this.text = text
    this.rate = 1
    this.voice = null
    this.onstart = null
    this.onend = null
    this.onerror = null
  }
}

function createFakeSynth() {
  const instances = []
  const synth = {
    speaking: false,
    paused: false,
    speak(utterance) {
      synth.speaking = true
      synth.paused = false
      instances.push(utterance)
    },
    cancel() {
      const utter = instances[instances.length - 1]
      synth.speaking = false
      utter?.onerror?.({ error: 'canceled' })
    },
    pause() {
      synth.paused = true
    },
    resume() {
      synth.paused = false
    },
    getVoices: () => [],
    addEventListener: () => {},
  }
  return { synth, instances }
}

function stubWebSpeech() {
  const { synth, instances } = createFakeSynth()
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  return { synth, instances }
}

beforeEach(() => {
  __resetVoiceCacheForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isWebSpeechSupported', () => {
  it('is false with no window/SpeechSynthesisUtterance in scope', () => {
    expect(isWebSpeechSupported()).toBe(false)
  })

  it('is true once speechSynthesis + SpeechSynthesisUtterance are stubbed', () => {
    stubWebSpeech()
    expect(isWebSpeechSupported()).toBe(true)
  })
})

describe('preferredDefaultVoice', () => {
  it('returns null for an empty list', () => {
    expect(preferredDefaultVoice([])).toBeNull()
    expect(preferredDefaultVoice(null)).toBeNull()
  })

  it('prefers an English, on-device (localService) voice', () => {
    const voices = [
      { lang: 'fr-FR', localService: true },
      { lang: 'en-US', localService: false },
      { lang: 'en-GB', localService: true },
    ]
    expect(preferredDefaultVoice(voices)).toBe(voices[2])
  })

  it('falls back to the first English voice when none are local', () => {
    const voices = [
      { lang: 'de-DE', localService: true },
      { lang: 'en-US', localService: false },
    ]
    expect(preferredDefaultVoice(voices)).toBe(voices[1])
  })

  it('falls back to the first voice at all when nothing is English', () => {
    const voices = [{ lang: 'de-DE', localService: false }]
    expect(preferredDefaultVoice(voices)).toBe(voices[0])
  })
})

describe('getWebSpeechVoices', () => {
  it('resolves immediately when voices are already populated', async () => {
    const { synth } = stubWebSpeech()
    synth.getVoices = () => [{ lang: 'en-US' }]
    await expect(getWebSpeechVoices()).resolves.toEqual([{ lang: 'en-US' }])
  })

  it('drops known-bad voices (novelty, legacy, character families) but keeps decent ones', async () => {
    const { synth } = stubWebSpeech()
    synth.getVoices = () => [
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'en-US', name: 'Zarvox' },
      { lang: 'en-US', name: 'Albert' },
      { lang: 'en-US', name: 'Eddy (English (United States))' },
      { lang: 'de-DE', name: 'Anna' },
      { lang: 'en-GB', name: 'Daniel' },
    ]
    await expect(getWebSpeechVoices()).resolves.toEqual([
      { lang: 'en-US', name: 'Samantha' },
      { lang: 'de-DE', name: 'Anna' },
      { lang: 'en-GB', name: 'Daniel' },
    ])
  })

  it('falls back to the unfiltered list if pruning would leave nothing', async () => {
    const { synth } = stubWebSpeech()
    synth.getVoices = () => [{ lang: 'en-US', name: 'Fred' }]
    await expect(getWebSpeechVoices()).resolves.toEqual([{ lang: 'en-US', name: 'Fred' }])
  })

  it('polls past a cold start where getVoices() is empty at first', async () => {
    vi.useFakeTimers()
    try {
      const { synth } = stubWebSpeech()
      let callCount = 0
      // Simulate a slow OS speech-service warm-up: empty for a few polls,
      // then populated -- the real-world case that motivated polling at all.
      synth.getVoices = () => {
        callCount += 1
        return callCount < 4 ? [] : [{ lang: 'en-GB', name: 'Late Voice' }]
      }

      const promise = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(500)

      await expect(promise).resolves.toEqual([{ lang: 'en-GB', name: 'Late Voice' }])
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up and resolves empty if voices never populate', async () => {
    vi.useFakeTimers()
    try {
      stubWebSpeech()
      const promise = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(3000)
      await expect(promise).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('runWebSpeechPlayback', () => {
  it('resolves immediately with zero chunks', async () => {
    stubWebSpeech()
    const { done } = runWebSpeechPlayback({ chunks: [] })
    await expect(done).resolves.toMatchObject({ chunksDone: 0, charsSpoken: 0 })
  })

  it('resolves immediately when the engine is unsupported', async () => {
    // No stubWebSpeech() call: window/SpeechSynthesisUtterance stay undefined.
    const { done } = runWebSpeechPlayback({ chunks: ['hello'] })
    await expect(done).resolves.toMatchObject({ chunksDone: 0 })
  })

  it('speaks chunks one at a time, firing onChunkStart/onProgress per chunk', async () => {
    const { instances } = stubWebSpeech()
    const starts = []
    const progress = []

    const { done } = runWebSpeechPlayback({
      chunks: ['one', 'two', 'three'],
      handlers: {
        onChunkStart: (i) => starts.push(i),
        onProgress: (info) => progress.push(info),
      },
    })

    expect(instances).toHaveLength(1)
    instances[0].onstart()
    expect(starts).toEqual([0])
    instances[0].onend()

    expect(instances).toHaveLength(2)
    expect(starts).toEqual([0]) // second chunk hasn't started yet
    instances[1].onstart()
    instances[1].onend()

    expect(instances).toHaveLength(3)
    instances[2].onstart()
    instances[2].onend()

    const result = await done
    expect(starts).toEqual([0, 1, 2])
    expect(progress).toHaveLength(3)
    expect(result.chunksDone).toBe(3)
    expect(result.charsSpoken).toBe('one'.length + 'two'.length + 'three'.length)
    expect(result.ttfaMs).not.toBeNull()
    expect(result.completed).toBe(true)
  })

  it('applies the selected voice and current rate to each utterance', () => {
    const { instances } = stubWebSpeech()
    const voice = { name: 'Test Voice' }
    runWebSpeechPlayback({ chunks: ['hi'], voice, initialRate: 1.5 })
    expect(instances[0].voice).toBe(voice)
    expect(instances[0].rate).toBe(1.5)
  })

  it('setSpeed changes the rate applied to the next chunk, not the current one', () => {
    const { instances } = stubWebSpeech()
    const { setSpeed } = runWebSpeechPlayback({ chunks: ['one', 'two'], initialRate: 1 })

    expect(instances[0].rate).toBe(1)
    setSpeed(2)
    expect(instances[0].rate).toBe(1) // already spoken at the old rate

    instances[0].onstart()
    instances[0].onend()
    expect(instances[1].rate).toBe(2)
  })

  it('stop() cancels synthesis and resolves done without throwing', async () => {
    const { synth, instances } = stubWebSpeech()
    const { done, stop } = runWebSpeechPlayback({ chunks: ['one', 'two'] })
    instances[0].onstart()

    stop()
    expect(synth.speaking).toBe(false)

    await expect(done).resolves.toMatchObject({ chunksDone: 0, completed: false })
    // No further utterances queued after stop.
    expect(instances).toHaveLength(1)
  })

  it('ignores expected interrupted/canceled errors but stops on real ones', async () => {
    const { instances } = stubWebSpeech()
    const { done } = runWebSpeechPlayback({ chunks: ['one', 'two'] })

    instances[0].onstart()
    // A real synthesis error should end playback early, not hang forever.
    instances[0].onerror({ error: 'synthesis-failed' })

    const result = await done
    expect(result.chunksDone).toBe(0)
    expect(result).toMatchObject({ completed: false, error: 'synthesis-failed' })
    expect(instances).toHaveLength(1) // never queued chunk two
  })
})
