/**
 * Instant, zero-download narration via the browser's built-in speechSynthesis
 * API. This is the zero-download fallback when Natural (Kokoro / WebGPU) is
 * unavailable or fails. Only voices the browser marks
 * `localService` are used; known online voices are never selected or spoken.
 *
 * Deliberately simpler than kokoroWorkerClient/playbackPipeline: speech
 * synthesis here is effectively instantaneous (no synth-ahead buffer to
 * manage), so chunks are spoken one at a time, each queued from the previous
 * chunk's `onend`.
 */

import { interChunkPauseMs } from './speechPacing.js'

// Voices that exist in some OS voice roster but are unusable for reading
// content aloud: Apple's joke/effects voices, its old pre-Siri robotic
// system voices (superseded by a modern voice in the same locale), and its
// exaggerated "character" voices meant for Live Speech, not narration. The
// character voices ship once per language (e.g. "Eddy (English (United
// States))", "Eddy (German (Germany))"...) so they're matched by the name
// before the first parenthetical. Matched case-insensitively; anything not
// on this list (including every other language's single standard voice)
// passes through untouched.
const LOW_QUALITY_VOICE_NAMES = new Set([
  'bad news',
  'bahh',
  'bells',
  'boing',
  'bubbles',
  'cellos',
  'good news',
  'jester',
  'organ',
  'pipe organ',
  'superstar',
  'trinoids',
  'whisper',
  'wobble',
  'zarvox',
  'albert',
  'fred',
  'junior',
  'kathy',
  'ralph',
  'eddy',
  'flo',
  'grandma',
  'grandpa',
  'reed',
  'rocko',
  'sandy',
  'shelley',
])

function baseVoiceName(name) {
  const idx = name.indexOf(' (')
  return (idx === -1 ? name : name.slice(0, idx)).trim().toLowerCase()
}

function isLowQualityVoice(voice) {
  return LOW_QUALITY_VOICE_NAMES.has(baseVoiceName(voice.name || ''))
}

/** Drops known-bad voices; if that empties a local-only list, keep the local list. */
function pruneLowQualityVoices(voices) {
  const kept = voices.filter((v) => !isLowQualityVoice(v))
  return kept.length ? kept : voices
}

/** Only voices the browser reports as on-device. Unverified/online voices are dropped. */
export function isVerifiedLocalVoice(voice) {
  return Boolean(voice && voice.localService === true)
}

export function localWebSpeechVoices(voices) {
  return (voices || []).filter(isVerifiedLocalVoice)
}

function usableLocalVoices(voices) {
  return pruneLowQualityVoices(localWebSpeechVoices(voices))
}

let cachedVoices = null
let voicesPromise = null

/** Test-only: clears the module-level voice cache between test cases. */
export function __resetVoiceCacheForTests() {
  cachedVoices = null
  voicesPromise = null
}

export function isWebSpeechSupported() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof SpeechSynthesisUtterance !== 'undefined'
  )
}

export const VOICE_POLL_INTERVAL_MS = 100
export const VOICE_POLL_MAX_ATTEMPTS = 20 // ~2s total -- a cold OS speech-service start can be slow

/**
 * Resolves with verified local (`localService === true`) voices.
 *
 * A remote-only first list is not treated as final: Chrome often emits Google
 * network voices before OS local voices. Wait on `voiceschanged` + polling
 * until a local voice appears or the timeout elapses.
 *
 * An empty timeout is not cached, so a later call can discover voices the OS
 * installs or reports late. Successful local lists are cached.
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function getWebSpeechVoices() {
  if (!isWebSpeechSupported()) return Promise.resolve([])
  if (cachedVoices?.length) return Promise.resolve(cachedVoices)
  if (voicesPromise) return voicesPromise

  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis
    let settled = false
    let attempts = 0
    let pollTimer = null

    const onVoicesChanged = () => consider(false)

    const cleanup = () => {
      if (pollTimer != null) {
        clearInterval(pollTimer)
        pollTimer = null
      }
      synth.removeEventListener?.('voiceschanged', onVoicesChanged)
    }

    const succeed = (local) => {
      if (settled) return
      settled = true
      cleanup()
      cachedVoices = local
      voicesPromise = null
      resolve(local)
    }

    const giveUp = () => {
      if (settled) return
      settled = true
      cleanup()
      cachedVoices = null
      voicesPromise = null
      resolve([])
    }

    const consider = (timedOut) => {
      const local = usableLocalVoices(synth.getVoices())
      if (local.length) {
        succeed(local)
        return
      }
      if (timedOut) giveUp()
    }

    consider(false)
    if (settled) return

    synth.addEventListener?.('voiceschanged', onVoicesChanged)
    pollTimer = setInterval(() => {
      attempts += 1
      consider(attempts >= VOICE_POLL_MAX_ATTEMPTS)
    }, VOICE_POLL_INTERVAL_MS)
  })

  return voicesPromise
}

export const LOCAL_VOICE_CHECKING_HINT = 'Looking for an on-device browser voice…'
export const LOCAL_VOICE_UNAVAILABLE_HINT =
  'No on-device browser voice is available here. Instant only uses voices your browser marks as local.'

/**
 * Prefer a verified on-device (localService) English voice. Never auto-select
 * a network voice or an unverified browser default.
 */
export function preferredDefaultVoice(voices) {
  const local = localWebSpeechVoices(voices)
  if (!local.length) return null
  const english = local.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  return english[0] || local[0]
}

export function voiceByURI(voices, uri) {
  if (!uri) return null
  return localWebSpeechVoices(voices).find((v) => v.voiceURI === uri) || null
}

/**
 * App-level Instant usability: API support, enumeration finished, and a
 * verified local voice URI that is still in the list.
 */
export function isInstantUsable({
  apiSupported = false,
  enumerationResolved = false,
  voiceURI = null,
  voices = [],
} = {}) {
  return Boolean(apiSupported && enumerationResolved && voiceByURI(voices, voiceURI))
}

// Chrome (desktop + Android) silently kills an utterance ~15s in unless the
// synth is paused/resumed periodically while speaking. No-op on engines
// without the bug. https://issues.chromium.org/issues/40473214
const CHROME_KEEPALIVE_MS = 5000

/**
 * @param {object} opts
 * @param {string[]} opts.chunks
 * @param {SpeechSynthesisVoice} opts.voice verified localService voice; required

 * @param {number} [opts.initialRate]
 * @param {{
 *   onChunkStart?: (index: number) => void,
 *   onProgress?: (info: { chunksDone: number, charsSpoken: number, ttfaMs: number | null }) => void,
 * }} [opts.handlers]
 * @returns {{
 *   setSpeed: (rate: number) => void,
 *   pause: () => void,
 *   resume: () => void,
 *   stop: () => void,
 *   done: Promise<object>,
 * }}
 */
export function runWebSpeechPlayback({ chunks, voice = null, initialRate = 1, handlers = {} }) {
  let resolveDone
  const done = new Promise((res) => {
    resolveDone = res
  })

  if (!chunks.length || !isWebSpeechSupported()) {
    resolveDone({ chunksDone: 0, charsSpoken: 0, ttfaMs: null, completed: false, error: null })
    return { setSpeed: () => {}, pause: () => {}, resume: () => {}, stop: () => {}, done }
  }

  if (!isVerifiedLocalVoice(voice)) {
    resolveDone({
      chunksDone: 0,
      charsSpoken: 0,
      ttfaMs: null,
      completed: false,
      error: 'no local voice',
    })
    return { setSpeed: () => {}, pause: () => {}, resume: () => {}, stop: () => {}, done }
  }

  const synth = window.speechSynthesis
  let index = 0
  let rate = initialRate
  let aborted = false
  let settled = false
  let charsSpoken = 0
  let chunksDone = 0
  let firstAudioAt = null
  let keepAliveTimer = null
  let transitionTimer = null
  let transitionStartedAt = null
  let pendingTransitionMs = null
  let paused = false
  let completed = false
  let playbackError = null
  const sessionStart = performance.now()

  const clearKeepAlive = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  const settle = () => {
    if (settled) return
    settled = true
    clearKeepAlive()
    if (transitionTimer) {
      clearTimeout(transitionTimer)
      transitionTimer = null
    }
    transitionStartedAt = null
    pendingTransitionMs = null
    resolveDone({
      chunksDone,
      charsSpoken,
      ttfaMs: firstAudioAt != null ? firstAudioAt - sessionStart : null,
      completed,
      error: playbackError,
    })
  }

  function scheduleNext(delayMs) {
    pendingTransitionMs = Math.max(0, delayMs)
    if (paused) return
    if (pendingTransitionMs === 0) {
      pendingTransitionMs = null
      speakNext()
      return
    }

    transitionStartedAt = performance.now()
    transitionTimer = setTimeout(() => {
      transitionTimer = null
      transitionStartedAt = null
      pendingTransitionMs = null
      speakNext()
    }, pendingTransitionMs)
  }

  function speakNext() {
    if (aborted) return
    if (index >= chunks.length) {
      completed = true
      settle()
      return
    }
    const text = chunks[index]
    const utter = new SpeechSynthesisUtterance(text)
    utter.voice = voice
    utter.rate = rate

    utter.onstart = () => {
      if (aborted) return
      if (firstAudioAt == null) firstAudioAt = performance.now()
      handlers.onChunkStart?.(index)
      clearKeepAlive()
      keepAliveTimer = setInterval(() => {
        if (synth.speaking && !synth.paused) {
          try {
            synth.pause()
            synth.resume()
          } catch {
            /* best-effort only */
          }
        }
      }, CHROME_KEEPALIVE_MS)
    }

    utter.onend = () => {
      if (aborted) return
      charsSpoken += text.length
      chunksDone += 1
      handlers.onProgress?.({
        chunksDone,
        charsSpoken,
        ttfaMs: firstAudioAt != null ? firstAudioAt - sessionStart : null,
      })
      index += 1
      scheduleNext(interChunkPauseMs(text))
    }

    utter.onerror = (e) => {
      if (aborted) return
      // Expected byproducts of stop(); not real failures.
      if (e.error === 'interrupted' || e.error === 'canceled') return
      aborted = true
      playbackError = e.error || 'speech synthesis error'
      settle()
    }

    synth.speak(utter)
  }

  speakNext()

  function stop() {
    if (aborted) return
    aborted = true
    clearKeepAlive()
    try {
      synth.cancel()
    } catch {
      /* already stopped */
    }
    settle()
  }

  // Utterance rate locks in at speak()-time -- the Web Speech API has no live
  // mid-utterance rate change. A new value takes effect on the *next* chunk.
  function setSpeed(newRate) {
    if (!newRate || newRate <= 0) return
    rate = newRate
  }

  function pause() {
    if (aborted || paused) return
    paused = true
    if (transitionTimer) {
      const elapsed = Math.max(0, performance.now() - (transitionStartedAt ?? performance.now()))
      pendingTransitionMs = Math.max(0, (pendingTransitionMs ?? 0) - elapsed)
      clearTimeout(transitionTimer)
      transitionTimer = null
      transitionStartedAt = null
    }
    try {
      synth.pause()
    } catch {
      /* best-effort only */
    }
  }

  function resume() {
    if (aborted || !paused) return
    paused = false
    try {
      synth.resume()
    } catch {
      /* best-effort only */
    }
    if (pendingTransitionMs != null && !transitionTimer) scheduleNext(pendingTransitionMs)
  }

  return { setSpeed, pause, resume, stop, done }
}
