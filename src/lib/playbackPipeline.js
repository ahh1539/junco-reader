/**
 * Clock-scheduled TTS playback with intentional sentence pacing.
 *
 * Chunks are synthesized in a worker (see kokoroWorkerClient.js) up to a
 * target seconds-of-audio buffer, well ahead of what's playing. Playback
 * itself never reacts to `onended` to decide when to start the next chunk
 * (that hop costs a main-thread tick and stacks with any jank); instead each
 * chunk's AudioBufferSourceNode is scheduled on the AudioContext clock the
 * instant the previous one is scheduled. Technical joins use a tiny overlap;
 * complete sentences receive a short, deliberate breath. `onended` is only
 * used for UI bookkeeping.
 *
 * Speed changes apply to the live source's `playbackRate` for instant
 * feedback, then cancel-and-reschedule the one pre-scheduled "next" node
 * (a not-yet-started source can be cancelled via `stop()`) against a
 * recomputed clock time -- see setSpeed().
 */

import { synthesizeChunk } from './kokoroWorkerClient.js'
import { MAX_DOWNLOAD_AUDIO_SECONDS } from './encodeWav.js'
import { interChunkPauseSeconds } from './speechPacing.js'

/** How many seconds of synthesized-but-unplayed audio to keep buffered. */
export const BUFFER_TARGET_SECONDS = 30

/**
 * Kokoro pads each generate() with low-level noise, not digital zero.
 * Peak-threshold 0.001 (-60 dBFS) leaves that padding in, so joins sound
 * like a 0.5–1s pause. Windowed RMS at ~-36 dBFS catches it.
 */
const SILENCE_RMS = 0.015
const WINDOW_SEC = 0.012
const LEAD_FLOOR_SEC = 0.012
const TAIL_FLOOR_SEC = 0.008
/** Short declick fade; in-place, mutates fresh-from-worker samples. */
const FADE_SEC = 0.008
/** Crossfade the two declick fades so residual pads don't become a hole. */
export const JOIN_OVERLAP_SEC = 0.02

function rmsAt(samples, from, win) {
  let sum = 0
  const end = Math.min(samples.length, from + win)
  const count = end - from
  if (count <= 0) return 0
  for (let i = from; i < end; i++) sum += samples[i] * samples[i]
  return Math.sqrt(sum / count)
}

/**
 * Trim excess leading/trailing near-silence (keeping a small floor) and
 * apply a short in-place declick fade. Mutates and returns `samples`.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 */
export function trimAndFade(samples, sampleRate) {
  const n = samples.length
  if (n < 32) return samples

  const win = Math.max(32, Math.floor(WINDOW_SEC * sampleRate))
  const step = Math.max(16, Math.floor(win / 2))
  const leadFloor = Math.floor(LEAD_FLOOR_SEC * sampleRate)
  const tailFloor = Math.floor(TAIL_FLOOR_SEC * sampleRate)

  let start = 0
  while (start + win <= n && rmsAt(samples, start, win) < SILENCE_RMS) start += step
  start = Math.max(0, start - leadFloor)

  let end = n - win
  while (end > start && rmsAt(samples, end, win) < SILENCE_RMS) end -= step
  end = Math.min(n - 1, end + win + tailFloor)

  if (end <= start + 32) return samples

  const trimmed = start === 0 && end === n - 1 ? samples : samples.subarray(start, end + 1)

  const fade = Math.min(Math.floor(FADE_SEC * sampleRate), Math.floor(trimmed.length / 4))
  if (fade >= 2) {
    for (let i = 0; i < fade; i++) {
      const g = i / fade
      trimmed[i] *= g
      trimmed[trimmed.length - 1 - i] *= g
    }
  }
  return trimmed
}

/**
 * @typedef {object} PipelineHandlers
 * @property {(index: number) => void} [onChunkStart]
 * @property {(info: {
 *   chunksDone: number,
 *   charsSpoken: number,
 *   synthMs: number,
 *   audioSec: number,
 *   ttfaMs: number | null,
 *   underruns: number,
 * }) => void} [onProgress]
 * @property {(info: {
 *   audioChunks: { samples: Float32Array, sampleRate: number }[],
 *   audioSec: number,
 * }) => void} [onAudioCap] Fired once when download collection hits the duration cap
 */

/**
 * Start pipelined playback over pre-chunked text. Returns immediately with a
 * controller; playback runs asynchronously. Await `controller.done` for
 * final stats.
 *
 * @param {object} opts
 * @param {string[]} opts.chunks
 * @param {string} opts.voice
 * @param {AudioContext} opts.audioCtx
 * @param {number} [opts.initialSpeed]
 * @param {PipelineHandlers} [opts.handlers]
 * @param {number} [opts.bufferTargetSeconds]
 * @param {boolean} [opts.collectAudio] When true, retain PCM for WAV export on done/stop
 * @param {number} [opts.maxDownloadAudioSec] Cap collected PCM length (default 15 min)
 * @returns {{ setSpeed: (rate: number) => void, stop: () => void, done: Promise<object> }}
 */
export function runPipelinedPlayback({
  chunks,
  voice,
  audioCtx,
  initialSpeed = 1,
  handlers = {},
  bufferTargetSeconds = BUFFER_TARGET_SECONDS,
  collectAudio = false,
  maxDownloadAudioSec = MAX_DOWNLOAD_AUDIO_SECONDS,
}) {
  let resolveDone
  let rejectDone
  const done = new Promise((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })

  if (!chunks.length) {
    resolveDone({
      chunksDone: 0,
      charsSpoken: 0,
      synthMs: 0,
      audioSec: 0,
      ttfaMs: null,
      underruns: 0,
      audioChunks: collectAudio ? [] : undefined,
      audioTruncated: false,
      audioDownloadedEarly: false,
    })
    return { setSpeed: () => {}, stop: () => {}, done }
  }

  const readyQueue = [] // { index, text, buffer, nominalDuration }
  /** @type {{ samples: Float32Array, sampleRate: number }[]} */
  const collectedAudio = collectAudio ? [] : null
  let collectedSec = 0
  let audioTruncated = false
  let audioCapNotified = false
  let nextToSynth = 0
  let chunksSynthesized = 0
  let synthMs = 0
  let audioSec = 0
  let charsSpoken = 0
  let chunksDone = 0
  let underruns = 0
  let firstAudioAt = null
  let aborted = false
  let settled = false
  const sessionStart = performance.now()

  let rate = initialSpeed
  let paused = false

  /** @type {{ node: AudioBufferSourceNode, item: object, startTime: number,
   *   consumedNominal: number, lastRateChangeAt: number, endTimeEstimate: number } | null} */
  let currentSlot = null
  /** @type {{ node: AudioBufferSourceNode, item: object, startTime: number, rateAtSchedule: number } | null} */
  let nextSlot = null

  const emit = () => {
    handlers.onProgress?.({
      chunksDone,
      charsSpoken,
      synthMs,
      audioSec,
      ttfaMs: firstAudioAt != null ? firstAudioAt - sessionStart : null,
      underruns,
    })
  }

  const bufferedSeconds = () =>
    readyQueue.reduce((sum, item) => sum + item.nominalDuration, 0) +
    (nextSlot ? nextSlot.item.nominalDuration : 0)

  let fillInFlight = null
  async function fillReady() {
    while (
      nextToSynth < chunks.length &&
      bufferedSeconds() < bufferTargetSeconds &&
      !aborted &&
      !paused
    ) {
      const index = nextToSynth
      nextToSynth += 1
      const text = chunks[index]
      const t0 = performance.now()
      let raw
      try {
        raw = await synthesizeChunk(text, { voice })
      } catch (err) {
        if (!aborted) {
          aborted = true
          settleError(err)
        }
        return
      }
      synthMs += performance.now() - t0
      if (aborted) return

      const samples = trimAndFade(
        raw.audio instanceof Float32Array ? raw.audio : new Float32Array(raw.audio),
        raw.sampling_rate,
      )
      if (collectedAudio) {
        const remaining = maxDownloadAudioSec - collectedSec
        if (remaining <= 0) {
          audioTruncated = true
        } else {
          const maxSamples = Math.floor(remaining * raw.sampling_rate)
          const clipped = samples.length > maxSamples
          const toStore = clipped ? samples.subarray(0, maxSamples) : samples
          if (clipped) audioTruncated = true
          // Copy so AudioBuffer ownership / later mutation cannot corrupt the export.
          collectedAudio.push({
            samples: new Float32Array(toStore),
            sampleRate: raw.sampling_rate,
          })
          collectedSec += toStore.length / raw.sampling_rate
          if (collectedSec >= maxDownloadAudioSec) audioTruncated = true
        }
        if (audioTruncated && !audioCapNotified) {
          audioCapNotified = true
          handlers.onAudioCap?.({
            audioChunks: collectedAudio.slice(),
            audioSec: collectedSec,
          })
          // Free PCM after the early download handler has encoded the blob.
          collectedAudio.length = 0
        }
      }
      const buffer = audioCtx.createBuffer(1, samples.length, raw.sampling_rate)
      buffer.copyToChannel(samples, 0)

      chunksSynthesized += 1
      readyQueue.push({ index, text, buffer, nominalDuration: buffer.duration })
      emit()
      scheduleNextIfPossible()
    }
  }

  function kickFill() {
    if (fillInFlight || aborted) return
    fillInFlight = fillReady().finally(() => {
      fillInFlight = null
      if (
        !paused &&
        !aborted &&
        nextToSynth < chunks.length &&
        bufferedSeconds() < bufferTargetSeconds
      ) {
        kickFill()
      }
    })
  }

  function joinStartTime() {
    if (!currentSlot) return audioCtx.currentTime
    const sentenceGap = interChunkPauseSeconds(currentSlot.item.text)
    const joinOffset = sentenceGap || -JOIN_OVERLAP_SEC / rate
    return Math.max(audioCtx.currentTime, currentSlot.endTimeEstimate + joinOffset)
  }

  function makeSource(buffer, startTime, playbackRate) {
    const node = audioCtx.createBufferSource()
    node.buffer = buffer
    node.playbackRate.value = playbackRate
    node.connect(audioCtx.destination)
    node.start(startTime)
    return node
  }

  // scheduleNextIfPossible always populates the "next" slot (start time
  // chained off whatever's currently playing, or "now" if nothing is).
  // Whenever that leaves currentSlot empty, promote immediately -- this one
  // rule covers both the very first chunk (currentSlot starts null) and
  // recovering from an underrun (both slots get cleared, then refilled).
  function scheduleNextIfPossible() {
    if (aborted || nextSlot || readyQueue.length === 0) return
    const item = readyQueue.shift()
    const startTime = joinStartTime()
    const node = makeSource(item.buffer, startTime, rate)
    node.onended = () => handleEnded(node)
    nextSlot = { node, item, startTime, rateAtSchedule: rate }
    kickFill()
    if (!currentSlot) promoteNext()
  }

  function promoteNext() {
    const prev = nextSlot
    nextSlot = null
    if (!prev) return false
    currentSlot = {
      node: prev.node,
      item: prev.item,
      startTime: prev.startTime,
      consumedNominal: 0,
      lastRateChangeAt: prev.startTime,
      endTimeEstimate: prev.startTime + prev.item.nominalDuration / prev.rateAtSchedule,
    }
    if (firstAudioAt == null) firstAudioAt = performance.now()
    handlers.onChunkStart?.(currentSlot.item.index)
    audioSec += currentSlot.item.nominalDuration
    charsSpoken += currentSlot.item.text.length
    chunksDone += 1
    emit()
    scheduleNextIfPossible()
    return true
  }

  function handleEnded(node) {
    if (aborted) return
    if (!currentSlot || currentSlot.node !== node) return // stale/cancelled node
    currentSlot = null

    if (promoteNext()) return

    // nextToSynth counts work that has been dispatched, not work that has
    // completed. Waiting for chunksSynthesized prevents an ending source from
    // resolving the session while the final worker request is still in flight.
    if (chunksSynthesized >= chunks.length && readyQueue.length === 0) {
      settleDone()
      return
    }

    // Ready queue hasn't caught up: genuine underrun. Start as soon as
    // something lands, at whatever the clock says "now" is.
    underruns += 1
    emit()
    kickFill()
  }

  function settleDone() {
    if (settled) return
    settled = true
    resolveDone({
      chunksDone,
      charsSpoken,
      synthMs,
      audioSec,
      ttfaMs: firstAudioAt != null ? firstAudioAt - sessionStart : null,
      underruns,
      ...(collectedAudio
        ? {
            audioChunks: collectedAudio,
            audioTruncated,
            audioDownloadedEarly: audioCapNotified,
          }
        : { audioTruncated: false, audioDownloadedEarly: false }),
    })
  }

  function settleError(err) {
    if (settled) return
    settled = true
    rejectDone(err)
  }

  function stop() {
    if (aborted) return
    aborted = true
    try {
      currentSlot?.node.stop()
    } catch {
      /* already stopped */
    }
    try {
      nextSlot?.node.stop()
    } catch {
      /* not started yet or already stopped */
    }
    currentSlot = null
    nextSlot = null
    settleDone()
  }

  function pause() {
    paused = true
  }

  function resume() {
    if (aborted || !paused) return
    paused = false
    kickFill()
  }

  /**
   * Live speed change. Applies instantly to the currently playing node and
   * reschedules the one pre-committed "next" node (safe: it hasn't started).
   * @param {number} newRate
   */
  function setSpeed(newRate) {
    if (!newRate || newRate <= 0) return
    if (currentSlot) {
      const now = audioCtx.currentTime
      // During an intentional sentence gap, the promoted source exists but its
      // scheduled start is still in the future. Do not count that wait as
      // consumed audio or pull the following source ahead of it.
      const effectiveNow = Math.max(now, currentSlot.startTime)
      const elapsed = Math.max(0, now - currentSlot.lastRateChangeAt)
      currentSlot.consumedNominal += elapsed * rate
      currentSlot.lastRateChangeAt = effectiveNow
      currentSlot.node.playbackRate.value = newRate
      rate = newRate

      const remainingNominal = Math.max(0, currentSlot.item.nominalDuration - currentSlot.consumedNominal)
      currentSlot.endTimeEstimate = effectiveNow + remainingNominal / rate

      if (nextSlot) {
        try {
          nextSlot.node.stop()
        } catch {
          /* ignore */
        }
        const item = nextSlot.item
        const sentenceGap = interChunkPauseSeconds(currentSlot.item.text)
        const joinOffset = sentenceGap || -JOIN_OVERLAP_SEC / rate
        const startTime = Math.max(effectiveNow, currentSlot.endTimeEstimate + joinOffset)
        const node = makeSource(item.buffer, startTime, rate)
        node.onended = () => handleEnded(node)
        nextSlot = { node, item, startTime, rateAtSchedule: rate }
      }
    } else if (nextSlot) {
      // Nothing promoted yet (kickoff race): next's start time doesn't
      // depend on a currentSlot, so just retune it in place -- no reschedule.
      nextSlot.node.playbackRate.value = newRate
      nextSlot.rateAtSchedule = newRate
      rate = newRate
    } else {
      rate = newRate
    }
  }

  kickFill()

  return { setSpeed, pause, resume, stop, done }
}
