import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  __resetVoiceCacheForTests,
  getWebSpeechVoices,
  isInstantUsable,
  isVerifiedLocalVoice,
  isWebSpeechSupported,
  localWebSpeechVoices,
  preferredDefaultVoice,
  runWebSpeechPlayback,
  voiceByURI,
  VOICE_POLL_INTERVAL_MS,
  VOICE_POLL_MAX_ATTEMPTS,
} from './webSpeechEngine'

const LOCAL = { lang: 'en-US', name: 'Samantha', localService: true, voiceURI: 'samantha' }

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
  const listeners = new Map()
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
    addEventListener(type, fn) {
      const set = listeners.get(type) || new Set()
      set.add(fn)
      listeners.set(type, set)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    dispatchVoicesChanged() {
      listeners.get('voiceschanged')?.forEach((fn) => fn())
    },
  }
  return { synth, instances, listeners }
}

function stubWebSpeech() {
  const { synth, instances, listeners } = createFakeSynth()
  vi.stubGlobal('window', { speechSynthesis: synth })
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance)
  return { synth, instances, listeners }
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

  it('does not default to a network voice when a local voice exists in another language', () => {
    const voices = [
      { lang: 'de-DE', localService: true },
      { lang: 'en-US', localService: false },
    ]
    expect(preferredDefaultVoice(voices)).toBe(voices[0])
  })

  it('returns null when only network voices exist', () => {
    const voices = [
      { lang: 'de-DE', localService: false },
      { lang: 'en-US', localService: false },
    ]
    expect(preferredDefaultVoice(voices)).toBeNull()
  })

  it('returns null while voice enumeration is empty (delayed OS list)', () => {
    expect(preferredDefaultVoice([])).toBeNull()
  })

  it('ignores unverified localService values', () => {
    expect(preferredDefaultVoice([{ lang: 'en-US', localService: undefined }])).toBeNull()
    expect(isVerifiedLocalVoice({ localService: false })).toBe(false)
    expect(isVerifiedLocalVoice({ localService: true })).toBe(true)
  })
})

describe('getWebSpeechVoices', () => {
  it('resolves immediately when local voices are already populated', async () => {
    const { synth } = stubWebSpeech()
    synth.getVoices = () => [{ lang: 'en-US', localService: true }]
    await expect(getWebSpeechVoices()).resolves.toEqual([{ lang: 'en-US', localService: true }])
  })

  it('drops known-bad voices (novelty, legacy, character families) but keeps decent local ones', async () => {
    const { synth } = stubWebSpeech()
    synth.getVoices = () => [
      { lang: 'en-US', name: 'Samantha', localService: true },
      { lang: 'en-US', name: 'Zarvox', localService: true },
      { lang: 'en-US', name: 'Albert', localService: true },
      { lang: 'en-US', name: 'Eddy (English (United States))', localService: true },
      { lang: 'de-DE', name: 'Anna', localService: true },
      { lang: 'en-GB', name: 'Daniel', localService: true },
    ]
    await expect(getWebSpeechVoices()).resolves.toEqual([
      { lang: 'en-US', name: 'Samantha', localService: true },
      { lang: 'de-DE', name: 'Anna', localService: true },
      { lang: 'en-GB', name: 'Daniel', localService: true },
    ])
  })

  it('does not resolve a remote-only first list; waits for a local voice', async () => {
    vi.useFakeTimers()
    try {
      const { synth, listeners } = stubWebSpeech()
      const remote = { lang: 'en-US', name: 'Google US English', localService: false, voiceURI: 'google' }
      const local = { lang: 'en-US', name: 'Samantha', localService: true, voiceURI: 'samantha' }
      synth.getVoices = () => [remote]

      let settled = false
      const promise = getWebSpeechVoices().then((voices) => {
        settled = true
        return voices
      })

      await vi.advanceTimersByTimeAsync(VOICE_POLL_INTERVAL_MS * 3)
      expect(settled).toBe(false)

      synth.getVoices = () => [remote, local]
      await vi.advanceTimersByTimeAsync(VOICE_POLL_INTERVAL_MS)

      await expect(promise).resolves.toEqual([local])
      expect(listeners.get('voiceschanged')?.size ?? 0).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never returns known online voices even if they are the only options', async () => {
    vi.useFakeTimers()
    try {
      const { synth, listeners } = stubWebSpeech()
      synth.getVoices = () => [
        { lang: 'en-US', name: 'Google US English', localService: false, voiceURI: 'google' },
        { lang: 'en-GB', name: 'Google UK English', localService: false, voiceURI: 'google-uk' },
      ]
      const promise = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(VOICE_POLL_INTERVAL_MS * VOICE_POLL_MAX_ATTEMPTS)
      await expect(promise).resolves.toEqual([])
      expect(listeners.get('voiceschanged')?.size ?? 0).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a local low-quality voice if pruning would otherwise leave no local voice', async () => {
    const { synth } = stubWebSpeech()
    synth.getVoices = () => [
      { lang: 'en-US', name: 'Fred', localService: true },
      { lang: 'en-US', name: 'Google US English', localService: false },
    ]
    await expect(getWebSpeechVoices()).resolves.toEqual([{ lang: 'en-US', name: 'Fred', localService: true }])
  })

  it('polls past a cold start where getVoices() is empty at first', async () => {
    vi.useFakeTimers()
    try {
      const { synth } = stubWebSpeech()
      let callCount = 0
      synth.getVoices = () => {
        callCount += 1
        return callCount < 4 ? [] : [{ lang: 'en-GB', name: 'Late Voice', localService: true }]
      }

      const promise = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(500)

      await expect(promise).resolves.toEqual([
        { lang: 'en-GB', name: 'Late Voice', localService: true },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up and resolves empty if voices never populate', async () => {
    vi.useFakeTimers()
    try {
      const { listeners } = stubWebSpeech()
      const promise = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(VOICE_POLL_INTERVAL_MS * VOICE_POLL_MAX_ATTEMPTS)
      await expect(promise).resolves.toEqual([])
      expect(listeners.get('voiceschanged')?.size ?? 0).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not cache an empty timeout, so a later call can discover a local voice', async () => {
    vi.useFakeTimers()
    try {
      const { synth } = stubWebSpeech()
      const first = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(VOICE_POLL_INTERVAL_MS * VOICE_POLL_MAX_ATTEMPTS)
      await expect(first).resolves.toEqual([])

      synth.getVoices = () => [{ lang: 'en-US', name: 'Late Local', localService: true, voiceURI: 'late' }]
      const second = getWebSpeechVoices()
      await vi.advanceTimersByTimeAsync(VOICE_POLL_INTERVAL_MS)
      await expect(second).resolves.toEqual([
        { lang: 'en-US', name: 'Late Local', localService: true, voiceURI: 'late' },
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('picks up a local voice from voiceschanged after a remote-only first list', async () => {
    vi.useFakeTimers()
    try {
      const { synth, listeners } = stubWebSpeech()
      const remote = { lang: 'en-US', name: 'Google US English', localService: false, voiceURI: 'google' }
      const local = { lang: 'en-US', name: 'Samantha', localService: true, voiceURI: 'samantha' }
      synth.getVoices = () => [remote]

      const promise = getWebSpeechVoices()
      synth.getVoices = () => [local]
      synth.dispatchVoicesChanged()

      await expect(promise).resolves.toEqual([local])
      expect(listeners.get('voiceschanged')?.size ?? 0).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('isInstantUsable', () => {
  const local = { voiceURI: 'local', localService: true }

  it('requires API support, resolved enumeration, and a verified local URI', () => {
    expect(
      isInstantUsable({
        apiSupported: true,
        enumerationResolved: true,
        voiceURI: 'local',
        voices: [local],
      }),
    ).toBe(true)
    expect(
      isInstantUsable({
        apiSupported: false,
        enumerationResolved: true,
        voiceURI: 'local',
        voices: [local],
      }),
    ).toBe(false)
    expect(
      isInstantUsable({
        apiSupported: true,
        enumerationResolved: false,
        voiceURI: 'local',
        voices: [local],
      }),
    ).toBe(false)
    expect(
      isInstantUsable({
        apiSupported: true,
        enumerationResolved: true,
        voiceURI: 'local',
        voices: [{ voiceURI: 'local', localService: false }],
      }),
    ).toBe(false)
    expect(
      isInstantUsable({
        apiSupported: true,
        enumerationResolved: true,
        voiceURI: null,
        voices: [local],
      }),
    ).toBe(false)
  })
})

describe('localWebSpeechVoices / voiceByURI', () => {
  it('selects only verified local voices by URI', () => {
    const voices = [
      { voiceURI: 'net', localService: false },
      { voiceURI: 'local', localService: true },
    ]
    expect(localWebSpeechVoices(voices)).toEqual([voices[1]])
    expect(voiceByURI(voices, 'local')).toBe(voices[1])
    expect(voiceByURI(voices, 'net')).toBeNull()
    expect(voiceByURI(voices, null)).toBeNull()
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

  it('does not speak without a verified local voice', async () => {
    const { instances } = stubWebSpeech()
    const { done } = runWebSpeechPlayback({ chunks: ['hello'] })
    await expect(done).resolves.toMatchObject({ chunksDone: 0, error: 'no local voice' })
    expect(instances).toHaveLength(0)
  })

  it('does not speak a known online voice', async () => {
    const { instances } = stubWebSpeech()
    const { done } = runWebSpeechPlayback({
      chunks: ['hello'],
      voice: { name: 'Google US English', localService: false },
    })
    await expect(done).resolves.toMatchObject({ chunksDone: 0, error: 'no local voice' })
    expect(instances).toHaveLength(0)
  })

  it('speaks chunks one at a time, firing onChunkStart/onProgress per chunk', async () => {
    const { instances } = stubWebSpeech()
    const starts = []
    const progress = []

    const { done } = runWebSpeechPlayback({
      chunks: ['one', 'two', 'three'],
      voice: LOCAL,
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

  it('waits briefly after a sentence before speaking the next chunk', async () => {
    vi.useFakeTimers()
    try {
      const { instances } = stubWebSpeech()
      const { done } = runWebSpeechPlayback({ chunks: ['One sentence.', 'The next'], voice: LOCAL })

      instances[0].onstart()
      instances[0].onend()
      expect(instances).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(119)
      expect(instances).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(instances).toHaveLength(2)

      instances[1].onstart()
      instances[1].onend()
      await expect(done).resolves.toMatchObject({ chunksDone: 2, completed: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds the remaining sentence gap while paused', async () => {
    vi.useFakeTimers()
    try {
      const { instances } = stubWebSpeech()
      const playback = runWebSpeechPlayback({
        chunks: ['One sentence.', 'The next'],
        voice: LOCAL,
      })

      instances[0].onstart()
      instances[0].onend()
      await vi.advanceTimersByTimeAsync(40)
      playback.pause()

      await vi.advanceTimersByTimeAsync(500)
      expect(instances).toHaveLength(1)

      playback.resume()
      await vi.advanceTimersByTimeAsync(79)
      expect(instances).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(instances).toHaveLength(2)

      playback.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('applies the selected voice and current rate to each utterance', () => {
    const { instances } = stubWebSpeech()
    const voice = { name: 'Test Voice', localService: true }
    runWebSpeechPlayback({ chunks: ['hi'], voice, initialRate: 1.5 })
    expect(instances[0].voice).toBe(voice)
    expect(instances[0].rate).toBe(1.5)
  })

  it('setSpeed changes the rate applied to the next chunk, not the current one', () => {
    const { instances } = stubWebSpeech()
    const { setSpeed } = runWebSpeechPlayback({ chunks: ['one', 'two'], voice: LOCAL, initialRate: 1 })

    expect(instances[0].rate).toBe(1)
    setSpeed(2)
    expect(instances[0].rate).toBe(1) // already spoken at the old rate

    instances[0].onstart()
    instances[0].onend()
    expect(instances[1].rate).toBe(2)
  })

  it('stop() cancels synthesis and resolves done without throwing', async () => {
    const { synth, instances } = stubWebSpeech()
    const { done, stop } = runWebSpeechPlayback({ chunks: ['one', 'two'], voice: LOCAL })
    instances[0].onstart()

    stop()
    expect(synth.speaking).toBe(false)

    await expect(done).resolves.toMatchObject({ chunksDone: 0, completed: false })
    // No further utterances queued after stop.
    expect(instances).toHaveLength(1)
  })

  it('ignores expected interrupted/canceled errors but stops on real ones', async () => {
    const { instances } = stubWebSpeech()
    const { done } = runWebSpeechPlayback({ chunks: ['one', 'two'], voice: LOCAL })

    instances[0].onstart()
    // A real synthesis error should end playback early, not hang forever.
    instances[0].onerror({ error: 'synthesis-failed' })

    const result = await done
    expect(result.chunksDone).toBe(0)
    expect(result).toMatchObject({ completed: false, error: 'synthesis-failed' })
    expect(instances).toHaveLength(1) // never queued chunk two
  })
})
