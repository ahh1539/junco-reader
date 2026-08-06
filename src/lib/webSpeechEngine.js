/**
 * Instant, zero-download narration via the browser's built-in speechSynthesis
 * API. No model to fetch, works everywhere Kokoro does (and beyond, e.g.
 * devices without WebGPU). Voice quality is just the OS default, not Kokoro's
 * neural model -- this is the fallback tier for skipping the model download,
 * not the default.
 *
 * Deliberately simpler than kokoroWorkerClient/playbackPipeline: speech
 * synthesis here is effectively instantaneous (no synth-ahead buffer to
 * manage), so chunks are spoken one at a time, each queued from the previous
 * chunk's `onend`.
 */

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

/** Drops known-bad voices; falls back to the unfiltered list if that empties it out. */
function pruneLowQualityVoices(voices) {
  const kept = voices.filter((v) => !isLowQualityVoice(v))
  return kept.length ? kept : voices
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

const VOICE_POLL_INTERVAL_MS = 100
const VOICE_POLL_MAX_ATTEMPTS = 20 // ~2s total -- a cold OS speech-service start can be slow

/**
 * Resolves with the browser's voice list. Some browsers (Chrome) populate
 * this asynchronously on first call, signalled by `voiceschanged` -- but on
 * a cold start (fresh process, OS speech service not warmed up yet) that
 * event can be slow or, on some platforms, never fire at all even once
 * voices are actually ready. Polling `getVoices()` as a safety net avoids
 * permanently caching an empty list just because we asked too early.
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export function getWebSpeechVoices() {
  if (!isWebSpeechSupported()) return Promise.resolve([])
  if (cachedVoices) return Promise.resolve(cachedVoices)
  if (voicesPromise) return voicesPromise

  voicesPromise = new Promise((resolve) => {
    const synth = window.speechSynthesis
    const existing = synth.getVoices()
    if (existing.length) {
      cachedVoices = pruneLowQualityVoices(existing)
      resolve(cachedVoices)
      return
    }

    let settled = false
    let attempts = 0
    let pollTimer = null

    const onVoicesChanged = () => {
      const voices = synth.getVoices()
      if (voices.length) finish(voices)
    }

    const finish = (voices) => {
      if (settled) return
      settled = true
      if (pollTimer) clearInterval(pollTimer)
      synth.removeEventListener?.('voiceschanged', onVoicesChanged)
      cachedVoices = pruneLowQualityVoices(voices)
      resolve(cachedVoices)
    }

    synth.addEventListener?.('voiceschanged', onVoicesChanged)
    pollTimer = setInterval(() => {
      attempts += 1
      const voices = synth.getVoices()
      if (voices.length || attempts >= VOICE_POLL_MAX_ATTEMPTS) finish(voices)
    }, VOICE_POLL_INTERVAL_MS)
  })
  return voicesPromise
}

/** Prefer an on-device English voice so "runs on your device" stays true here too. */
export function preferredDefaultVoice(voices) {
  if (!voices?.length) return null
  const english = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'))
  const pool = english.length ? english : voices
  return pool.find((v) => v.localService) ?? pool[0]
}

// Chrome (desktop + Android) silently kills an utterance ~15s in unless the
// synth is paused/resumed periodically while speaking. No-op on engines
// without the bug. https://issues.chromium.org/issues/40473214
const CHROME_KEEPALIVE_MS = 5000

/**
 * @param {object} opts
 * @param {string[]} opts.chunks
 * @param {SpeechSynthesisVoice | null} [opts.voice]
 * @param {number} [opts.initialRate]
 * @param {{
 *   onChunkStart?: (index: number) => void,
 *   onProgress?: (info: { chunksDone: number, charsSpoken: number, ttfaMs: number | null }) => void,
 * }} [opts.handlers]
 * @returns {{ setSpeed: (rate: number) => void, stop: () => void, done: Promise<object> }}
 */
export function runWebSpeechPlayback({ chunks, voice = null, initialRate = 1, handlers = {} }) {
  let resolveDone
  const done = new Promise((res) => {
    resolveDone = res
  })

  if (!chunks.length || !isWebSpeechSupported()) {
    resolveDone({ chunksDone: 0, charsSpoken: 0, ttfaMs: null, completed: false, error: null })
    return { setSpeed: () => {}, stop: () => {}, done }
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
    resolveDone({
      chunksDone,
      charsSpoken,
      ttfaMs: firstAudioAt != null ? firstAudioAt - sessionStart : null,
      completed,
      error: playbackError,
    })
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
    if (voice) utter.voice = voice
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
      speakNext()
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

  return { setSpeed, stop, done }
}
