import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import AppStoreCta from './components/AppStoreCta'
import CapabilityBanner from './components/CapabilityBanner'
import DocumentPreview from './components/DocumentPreview'
import DropZone from './components/DropZone'
import EpubViewToggle, {
  EPUB_VIEW_LISTENING_ROOM,
  EPUB_VIEW_READER,
} from './components/EpubViewToggle'
import GenerationStats from './components/GenerationStats'
import ListeningRoom from './components/ListeningRoom'
import ModelDownloadButton from './components/ModelDownloadButton'
import Player from './components/Player'
import PlaybackTargetNotice from './components/PlaybackTargetNotice'
import PostListenNudge from './components/PostListenNudge'
import SpeedControl from './components/SpeedControl'
import VoicePicker from './components/VoicePicker'

import { getCapabilityMessage } from './lib/capability'
import { CRUISE_CAP_INDEX, chunkTextWithOffsets } from './lib/chunkText'
import { downloadWav, MAX_DOWNLOAD_AUDIO_SECONDS } from './lib/encodeWav'
import {
  bookProgressPercent,
  chapterCoordinateLengths,
  clearEpubProgress,
  loadEpubProgress,
  saveEpubProgress,
} from './lib/epubProgress'
import {
  adjacentSection,
  chapterStartIndexes as buildChapterStartIndexes,
  chunkIndexForSection,
  nearestSection,
} from './lib/epubSeek'
import { extractFromFile, extractFromPaste } from './lib/extractText'
import { formatForTts } from './lib/formatForTts'
import {
  DEFAULT_DISPLAY_SIZE,
  clearModelCache,
  isModelCached,
} from './lib/modelCache'
import {
  chooseRuntime,
  clearStaleCompatibilityMode,
  isNaturalRuntime,
  NATURAL_CHECKING_HINT,
  NATURAL_UNAVAILABLE_HINT,
  NO_SUPPORTED_SPEECH_HINT,
  naturalFailureMessage,
  runtimeFromMeta,
  speechAvailabilityHint,
} from './lib/kokoroEngine'
import {
  getLoadedMeta,
  loadKokoro,
  unloadKokoro,
  warmUp,
} from './lib/kokoroWorkerClient'
import { runPipelinedPlayback } from './lib/playbackPipeline'
import {
  isGlobalPlaybackShortcut,
  shouldApplyNaturalProbe,
  shouldApplyVoiceProbe,
  shouldStartNaturalPipeline,
} from './lib/playbackGuard'
import {
  getWebSpeechVoices,
  isInstantUsable,
  isWebSpeechSupported,
  LOCAL_VOICE_CHECKING_HINT,
  LOCAL_VOICE_UNAVAILABLE_HINT,
  preferredDefaultVoice,
  runWebSpeechPlayback,
  voiceByURI,
} from './lib/webSpeechEngine'
import { SPEED_OPTIONS } from './lib/playbackSpeeds'
import { SAMPLE_DOCUMENT_NAME, sampleDocument } from './lib/sampleDocument'
import { useWebMcpTools } from './lib/useWebMcpTools'
import { epubChapterListing } from './lib/webmcpListing'
import {
  clearShareParamFromUrl,
  hasIncomingShareParam,
  takeSharedFile,
  takeSharedText,
} from './lib/incomingShare'
import { ensureVoiceBinCached } from './lib/kokoroVoices'
import { DEFAULT_VOICE_ID, VOICES, voiceById } from './lib/voices'
import { MARKETING_URL } from './lib/appStore'
import { Events, track } from './lib/analytics'
import { hasSeenNudge, markNudgeSeen } from './lib/postListenNudge'

import './App.css'

const WEB_SPEECH_SUPPORTED = isWebSpeechSupported()

// Build a short, valid PCM WAV for the hidden media-session anchor. Keeping it
// generated avoids shipping a separate binary asset; unlike a header-only WAV,
// this has a real duration and can retain browser audio focus while looping.
function createSilentWavBlob() {
  const sampleRate = 8000
  const sampleCount = Math.round(sampleRate / 4)
  const buffer = new ArrayBuffer(44 + sampleCount)
  const view = new DataView(buffer)
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + sampleCount, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  writeAscii(36, 'data')
  view.setUint32(40, sampleCount, true)
  new Uint8Array(buffer, 44).fill(128)
  return new Blob([buffer], { type: 'audio/wav' })
}

export default function App() {
  const [document, setDocument] = useState(null)
  const [paste, setPaste] = useState('')
  const [ingestError, setIngestError] = useState(null)
  const [ingestBusy, setIngestBusy] = useState(false)

  // Natural is preferred. Capability detection falls back to Instant when
  // WebGPU is unavailable and a verified local browser voice exists.
  const [engine, setEngine] = useState('kokoro')
  const [webSpeechVoices, setWebSpeechVoices] = useState([])
  const [webSpeechVoiceURI, setWebSpeechVoiceURI] = useState(null)
  const [instantVoicesReady, setInstantVoicesReady] = useState(false)

  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [speed, setSpeedState] = useState(1)
  const [downloadAudio, setDownloadAudio] = useState(false)
  const [optimizeForSpeech, setOptimizeForSpeech] = useState(true)
  const [modelStatus, setModelStatus] = useState('unknown') // unknown | needed | downloading | loading | ready
  const [modelProgress, setModelProgress] = useState(0)
  const [modelError, setModelError] = useState(null)
  const [displaySize, setDisplaySize] = useState(DEFAULT_DISPLAY_SIZE)
  const [deviceLabel, setDeviceLabel] = useState(null)
  const [removingModel, setRemovingModel] = useState(false)
  const [naturalAvailable, setNaturalAvailable] = useState(null)
  const [offerBuiltInFallback, setOfferBuiltInFallback] = useState(false)

  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [pipelineReady, setPipelineReady] = useState(false)
  const [activeChunk, setActiveChunk] = useState(-1)
  const [playError, setPlayError] = useState(null)
  const [downloadNote, setDownloadNote] = useState(null)

  const [capabilityMsg, setCapabilityMsg] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [genStats, setGenStats] = useState(null)
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0)
  const [browsingTarget, setBrowsingTarget] = useState(null)
  const [resumePosition, setResumePosition] = useState(null)
  const [epubViewMode, setEpubViewMode] = useState(EPUB_VIEW_READER)

  const audioCtxRef = useRef(null)
  const mediaAnchorRef = useRef(null)
  const playbackRef = useRef(null) // { setSpeed, stop, done } from either engine
  const stoppedRef = useRef(false)
  const pausedRef = useRef(false)
  const speedRef = useRef(1)
  const downloadAudioRef = useRef(false)
  const runtimeRef = useRef(null) // cached chooseRuntime() result
  const listenedChunksRef = useRef(0)
  const statsThrottleRef = useRef(0)
  const modelProgressThrottleRef = useRef(0)
  const modelLoadStartedRef = useRef(false)
  const runtimeVersionRef = useRef(0)
  const probeGenerationRef = useRef(0)
  const firstPlayTrackedRef = useRef(false)
  const playbackRunRef = useRef(0)
  const instantPlayRef = useRef(false)
  const epubProgressTimerRef = useRef(null)
  const pendingEpubProgressRef = useRef(null)
  const webmcpActionsRef = useRef({})

  const instantUsable = isInstantUsable({
    apiSupported: WEB_SPEECH_SUPPORTED,
    enumerationResolved: instantVoicesReady,
    voiceURI: webSpeechVoiceURI,
    voices: webSpeechVoices,
  })
  const noSupportedSpeech = naturalAvailable === false && instantVoicesReady && !instantUsable
  const availabilityHint = speechAvailabilityHint({
    naturalAvailable,
    instantUsable,
    instantResolved: instantVoicesReady,
  })

  const isEpub = document?.kind === 'epub'
  const isListeningRoomView = isEpub && epubViewMode === EPUB_VIEW_LISTENING_ROOM
  const chunkRecords = useMemo(() => {
    if (!document?.text) return []

    if (document.kind === 'epub') {
      return (document.chapters || []).flatMap((chapter, chapterIndex) => {
        const speechText = optimizeForSpeech ? formatForTts(chapter.text) : chapter.text
        return chunkTextWithOffsets(speechText, {
          capIndexOffset: chapterIndex === 0 ? 0 : CRUISE_CAP_INDEX,
        }).map((chunk) => ({
          ...chunk,
          chapterId: chapter.id,
          chapterIndex,
        }))
      })
    }

    const speechText = optimizeForSpeech ? formatForTts(document.text) : document.text
    return chunkTextWithOffsets(speechText).map((chunk) => ({
      ...chunk,
      chapterId: null,
      chapterIndex: 0,
    }))
  }, [document, optimizeForSpeech])

  const chunks = useMemo(() => chunkRecords.map((chunk) => chunk.text), [chunkRecords])

  const chapterStartIndexes = useMemo(
    () => buildChapterStartIndexes(chunkRecords),
    [chunkRecords],
  )
  const epubChapterLengths = useMemo(
    () =>
      isEpub
        ? chapterCoordinateLengths(chunkRecords, document?.chapters?.length || 0)
        : [],
    [chunkRecords, document?.chapters?.length, isEpub],
  )

  useEffect(() => {
    let cancelled = false
    const probeGeneration = ++probeGenerationRef.current
    const initialRuntimeVersion = runtimeVersionRef.current
    clearStaleCompatibilityMode()
    ;(async () => {
      const [runtime, webSpeechVoiceList] = await Promise.all([
        chooseRuntime(),
        getWebSpeechVoices(),
      ])
      const cap = await getCapabilityMessage({ webgpu: isNaturalRuntime(runtime) })

      if (
        !shouldApplyVoiceProbe({
          cancelled,
          probeGeneration,
          currentProbeGeneration: probeGenerationRef.current,
        })
      ) {
        return
      }

      setCapabilityMsg(cap)
      setWebSpeechVoices(webSpeechVoiceList)
      setInstantVoicesReady(true)
      setWebSpeechVoiceURI((current) => {
        if (current && webSpeechVoiceList.some((voice) => voice.voiceURI === current)) return current
        return preferredDefaultVoice(webSpeechVoiceList)?.voiceURI ?? null
      })

      if (
        !shouldApplyNaturalProbe({
          cancelled,
          probeGeneration,
          currentProbeGeneration: probeGenerationRef.current,
          runtimeVersion: initialRuntimeVersion,
          currentRuntimeVersion: runtimeVersionRef.current,
          modelLoadStarted: modelLoadStartedRef.current,
        })
      ) {
        return
      }

      const available = isNaturalRuntime(runtime)
      setNaturalAvailable(available)
      if (!available && webSpeechVoiceList.length) {
        setEngine((current) => (current === 'kokoro' ? 'webspeech' : current))
      }

      runtimeRef.current = runtime
      if (!available) {
        setDisplaySize(runtime.displaySize || DEFAULT_DISPLAY_SIZE)
        setDeviceLabel(null)
        setModelStatus('needed')
        return
      }
      const cached = await isModelCached(runtime)
      if (
        !shouldApplyNaturalProbe({
          cancelled,
          probeGeneration,
          currentProbeGeneration: probeGenerationRef.current,
          runtimeVersion: initialRuntimeVersion,
          currentRuntimeVersion: runtimeVersionRef.current,
          modelLoadStarted: modelLoadStartedRef.current,
        })
      ) {
        return
      }
      setDisplaySize(runtime.displaySize || DEFAULT_DISPLAY_SIZE)
      setDeviceLabel(runtime.note)
      setModelStatus(cached ? 'ready' : 'needed')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const ensureAudio = useCallback(() => {
    if (!audioCtxRef.current) {
      // Kokoro emits 24kHz; matching the context rate skips per-buffer
      // resampling on every chunk.
      try {
        audioCtxRef.current = new AudioContext({ sampleRate: 24000, latencyHint: 'playback' })
      } catch {
        audioCtxRef.current = new AudioContext()
      }
    }
    return audioCtxRef.current
  }, [])

  // Chrome only allows AudioContext create/resume inside the user-gesture
  // turn. runKokoro awaits model warmup first, which drops that gesture and
  // leaves the clock suspended — chunks then schedule against a frozen
  // currentTime and play with holes. Unlock synchronously from click/keydown.
  const unlockAudio = useCallback(() => {
    const ctx = ensureAudio()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  }, [ensureAudio])

  const ensureRuntime = useCallback(async () => {
    if (!runtimeRef.current) runtimeRef.current = await chooseRuntime()
    if (!isNaturalRuntime(runtimeRef.current)) {
      setNaturalAvailable(false)
      throw new Error(NATURAL_UNAVAILABLE_HINT)
    }
    return runtimeRef.current
  }, [])

  const reportModelProgress = useCallback((info) => {
    if (info?.status !== 'progress' || typeof info.progress !== 'number') return false
    const raw = info.progress
    const percent = raw <= 1 ? raw * 100 : raw
    const now = performance.now()
    // Model downloads can emit hundreds of byte-level events. Limiting UI
    // updates keeps a loaded EPUB preview mounted and responsive on the
    // first, most memory-intensive download.
    if (percent < 100 && now - modelProgressThrottleRef.current < 100) return true
    modelProgressThrottleRef.current = now
    setModelProgress(percent)
    return true
  }, [])

  const handleDownload = useCallback(async () => {
    if (removingModel) return
    modelLoadStartedRef.current = true
    track(Events.MODEL_DOWNLOAD_START)
    setModelError(null)
    setOfferBuiltInFallback(false)
    setModelStatus('downloading')
    setModelProgress(0)
    modelProgressThrottleRef.current = 0
    try {
      const runtime = await ensureRuntime()
      const meta = await loadKokoro({
        device: runtime.device,
        dtype: runtime.dtype,
        onProgress: (info) => {
          if (reportModelProgress(info)) {
            setModelStatus('downloading')
          } else if (info?.status === 'done' || info?.status === 'ready') {
            setModelProgress(100)
          } else if (info?.status === 'initiate') {
            setModelStatus('downloading')
          }
        },
      })
      const actualRuntime = runtimeFromMeta(meta)
      if (!actualRuntime) {
        unloadKokoro()
        throw new Error('Natural voice did not load on WebGPU.')
      }
      runtimeRef.current = actualRuntime
      setDisplaySize(actualRuntime.displaySize)
      setDeviceLabel(actualRuntime.note)
      setModelProgress(100)
      setModelStatus('ready')
      track(Events.MODEL_DOWNLOAD_COMPLETE, { device: meta.device, dtype: meta.dtype })
      try {
        await ensureVoiceBinCached(voiceId)
        await warmUp(voiceId)
      } catch (voiceErr) {
        console.error(voiceErr)
        setModelError(naturalFailureMessage(voiceErr))
        setOfferBuiltInFallback(instantUsable)
      }
    } catch (err) {
      console.error(err)
      setModelStatus('needed')
      setModelError(naturalFailureMessage(err))
      setOfferBuiltInFallback(instantUsable)
    }
  }, [ensureRuntime, instantUsable, removingModel, reportModelProgress, voiceId])

  const ensureEngine = useCallback(async () => {
    const alreadyLoaded = Boolean(getLoadedMeta().device)
    modelLoadStartedRef.current = true
    if (!alreadyLoaded) setModelStatus((s) => (s === 'ready' ? 'loading' : 'downloading'))
    modelProgressThrottleRef.current = 0
    const runtime = await ensureRuntime()
    const meta = await loadKokoro({
      device: runtime.device,
      dtype: runtime.dtype,
      onProgress: (info) => {
        reportModelProgress(info)
      },
    })
    const actualRuntime = runtimeFromMeta(meta)
    if (!actualRuntime) {
      unloadKokoro()
      throw new Error('Natural voice did not load on WebGPU.')
    }
    await ensureVoiceBinCached(voiceId)
    await warmUp(voiceId)
    runtimeRef.current = actualRuntime
    setDisplaySize(actualRuntime.displaySize)
    setDeviceLabel(actualRuntime.note)
    setModelStatus('ready')
    return meta
  }, [ensureRuntime, reportModelProgress, voiceId])

  const flushEpubProgress = useCallback(() => {
    if (epubProgressTimerRef.current != null) {
      clearTimeout(epubProgressTimerRef.current)
      epubProgressTimerRef.current = null
    }
    const pending = pendingEpubProgressRef.current
    pendingEpubProgressRef.current = null
    if (!pending) return
    saveEpubProgress(pending.fingerprint, pending.progress)
  }, [])

  const stopPlayback = useCallback(() => {
    flushEpubProgress()
    playbackRunRef.current += 1
    stoppedRef.current = true
    pausedRef.current = false
    playbackRef.current?.stop()
    playbackRef.current = null
    setPipelineReady(false)
    setPlaying(false)
    setPaused(false)
    setActiveChunk(-1)
    try {
      if (audioCtxRef.current?.state === 'running') audioCtxRef.current.suspend()
    } catch {
      /* ignore */
    }
  }, [flushEpubProgress])

  const applyDocument = useCallback((nextDocument) => {
    setDocument(nextDocument)
    setEpubViewMode(nextDocument?.kind === 'epub' ? EPUB_VIEW_LISTENING_ROOM : EPUB_VIEW_READER)
    setGenStats(null)
    setActiveChunk(-1)
    setSelectedChapterIndex(0)
    setBrowsingTarget(null)
    setResumePosition(null)

    if (nextDocument?.kind !== 'epub' || !nextDocument.meta?.fingerprint) return
    const saved = loadEpubProgress(nextDocument.meta.fingerprint)
    if (!saved) return

    const chapterIndex = nextDocument.chapters?.findIndex((chapter) => chapter.id === saved.chapterId)
    if (chapterIndex == null || chapterIndex < 0) return
    setSelectedChapterIndex(chapterIndex)
    setResumePosition({ ...saved, chapterIndex })
  }, [])

  const handlePlaybackChunkStart = useCallback(
    (index, playbackRun) => {
      if (playbackRun != null && playbackRunRef.current !== playbackRun) return
      setActiveChunk(index)
      setBrowsingTarget((current) => (current?.chunkIndex === index ? null : current))
      if (document?.kind !== 'epub' || !document.meta?.fingerprint) return
      const chunk = chunkRecords[index]
      if (!chunk?.chapterId) return
      pendingEpubProgressRef.current = {
        fingerprint: document.meta.fingerprint,
        progress: {
          chapterId: chunk.chapterId,
          chapterIndex: chunk.chapterIndex,
          characterOffset: chunk.startOffset,
          optimized: optimizeForSpeech,
        },
      }
      if (epubProgressTimerRef.current != null) {
        clearTimeout(epubProgressTimerRef.current)
      }
      epubProgressTimerRef.current = setTimeout(() => {
        epubProgressTimerRef.current = null
        flushEpubProgress()
      }, 1000)
    },
    [chunkRecords, document, flushEpubProgress, optimizeForSpeech],
  )

  const markEpubPlaybackComplete = useCallback(() => {
    pendingEpubProgressRef.current = null
    if (epubProgressTimerRef.current != null) {
      clearTimeout(epubProgressTimerRef.current)
      epubProgressTimerRef.current = null
    }
    if (document?.kind !== 'epub' || !document.meta?.fingerprint) return
    clearEpubProgress(document.meta.fingerprint)
    setResumePosition(null)
  }, [document])

  const handleRemoveModel = useCallback(async () => {
    const ok = window.confirm(
      'Remove the voice model from this device? You can download it again anytime. Your documents are not stored and will not be affected.',
    )
    if (!ok) return false

    setRemovingModel(true)
    setModelError(null)
    try {
      runtimeVersionRef.current += 1
      modelLoadStartedRef.current = true
      stopPlayback()
      unloadKokoro()
      await clearModelCache()
      setModelProgress(0)
      setModelStatus('needed')
      setGenStats(null)
      return true
    } catch (err) {
      console.error(err)
      setModelError(err?.message || 'Could not remove the cached model.')
      return false
    } finally {
      setRemovingModel(false)
    }
  }, [stopPlayback])

  const maybeShowNudge = useCallback(() => {
    if (hasSeenNudge()) return
    if (listenedChunksRef.current >= 1) {
      markNudgeSeen()
      setNudgeOpen(true)
    }
  }, [])

  const runWebSpeech = useCallback(
    async (startIndex, playbackRun) => {
      const playChunks = chunks.slice(startIndex)
      const voice = voiceByURI(webSpeechVoices, webSpeechVoiceURI)
      const isCurrentRun = () => playbackRunRef.current === playbackRun

      if (!voice) {
        if (isCurrentRun()) {
          setPlayError(LOCAL_VOICE_UNAVAILABLE_HINT)
          setPlaying(false)
          setPaused(false)
          pausedRef.current = false
          setPipelineReady(false)
        }
        return
      }

      try {
        const playback = runWebSpeechPlayback({
          chunks: playChunks,
          voice,
          initialRate: speedRef.current,
          handlers: {
            onChunkStart: (i) => handlePlaybackChunkStart(startIndex + i, playbackRun),
            onProgress: (info) => {
              if (isCurrentRun()) listenedChunksRef.current = info.chunksDone
            },
          },
        })
        playbackRef.current = playback
        setPipelineReady(true)
        const result = await playback.done
        if (result.error && isCurrentRun()) {
          setPlayError(`Playback failed: ${result.error}.`)
        }
        if (!stoppedRef.current && result.completed && isCurrentRun()) {
          markEpubPlaybackComplete()
          setActiveChunk(-1)
          maybeShowNudge()
        }
      } catch (err) {
        console.error(err)
        if (isCurrentRun()) setPlayError(err?.message || 'Playback failed.')
      } finally {
        if (isCurrentRun()) {
          playbackRef.current = null
          setPipelineReady(false)
          setPlaying(false)
          setPaused(false)
          pausedRef.current = false
        }
      }
    },
    [chunks, handlePlaybackChunkStart, markEpubPlaybackComplete, maybeShowNudge, webSpeechVoiceURI, webSpeechVoices],
  )

  const runKokoro = useCallback(
    async (startIndex, playbackRun) => {
      const voice = voiceById(voiceId)
      const playChunks = chunks.slice(startIndex)
      const shouldCollectAudio = downloadAudioRef.current && document?.kind !== 'epub'
      const isCurrentRun = () => playbackRunRef.current === playbackRun

      const pushStats = (live, partial = {}) => {
        if (!isCurrentRun()) return
        if (live) {
          const now = performance.now()
          if (now - statsThrottleRef.current < 150) return
          statsThrottleRef.current = now
        }
        const meta = getLoadedMeta()
        setGenStats({
          live,
          voice: voice.displayName,
          device: meta.device === 'webgpu' ? 'WebGPU' : null,
          dtype: meta.dtype || null,
          speed: speedRef.current,
          chunksDone: partial.chunksDone ?? 0,
          chunksTotal: playChunks.length,
          charsSpoken: partial.charsSpoken ?? 0,
          ttfaMs: partial.ttfaMs ?? null,
          synthMs: partial.synthMs ?? null,
          audioSec: partial.audioSec ?? null,
          rtf:
            partial.audioSec > 0 && partial.synthMs > 0
              ? partial.synthMs / 1000 / partial.audioSec
              : null,
          underruns: partial.underruns ?? 0,
        })
      }

      pushStats(true)

      const stillThisRun = () =>
        shouldStartNaturalPipeline({
          playbackRun,
          currentRun: playbackRunRef.current,
          stopped: stoppedRef.current,
          paused: pausedRef.current,
        })

      try {
        if (!stillThisRun()) return
        const ctx = audioCtxRef.current || unlockAudio()
        await ensureEngine()
        if (!stillThisRun()) return
        if (ctx.state === 'suspended') await ctx.resume()
        if (!stillThisRun()) return

        const playback = runPipelinedPlayback({
          chunks: playChunks,
          voice: voiceId,
          audioCtx: ctx,
          initialSpeed: speedRef.current,
          collectAudio: shouldCollectAudio,
          handlers: {
            onChunkStart: (i) => handlePlaybackChunkStart(startIndex + i, playbackRun),
            onProgress: (info) => {
              if (isCurrentRun()) listenedChunksRef.current = info.chunksDone
              pushStats(true, info)
            },
            onAudioCap: (info) => {
              if (!isCurrentRun() || !shouldCollectAudio || !info.audioChunks?.length) return
              try {
                downloadWav(info.audioChunks, document?.name)
                track(Events.AUDIO_DOWNLOAD, {
                  chunks: info.audioChunks.length,
                  partial: false,
                  truncated: true,
                  early: true,
                  max_sec: MAX_DOWNLOAD_AUDIO_SECONDS,
                })
                const mins = Math.round(MAX_DOWNLOAD_AUDIO_SECONDS / 60)
                setDownloadNote(
                  `Saved the first ${mins} minutes of audio (download limit). Listening can continue.`,
                )
              } catch (err) {
                console.error(err)
                setPlayError(err?.message || 'Could not save the audio file.')
              }
            },
          },
        })
        playbackRef.current = playback
        setPipelineReady(true)

        const result = await playback.done
        pushStats(false, result)

        // Skip end-of-session download if we already saved when the cap was hit.
        if (
          isCurrentRun() &&
          shouldCollectAudio &&
          result.audioChunks?.length &&
          !result.audioDownloadedEarly
        ) {
          try {
            downloadWav(result.audioChunks, document?.name)
            track(Events.AUDIO_DOWNLOAD, {
              chunks: result.audioChunks.length,
              partial: Boolean(stoppedRef.current),
              truncated: Boolean(result.audioTruncated),
              max_sec: MAX_DOWNLOAD_AUDIO_SECONDS,
            })
            if (result.audioTruncated) {
              const mins = Math.round(MAX_DOWNLOAD_AUDIO_SECONDS / 60)
              setDownloadNote(
                `Saved the first ${mins} minutes of audio (download limit). Listening can continue.`,
              )
            }
          } catch (err) {
            console.error(err)
            setPlayError(err?.message || 'Could not save the audio file.')
          }
        }

        if (!stoppedRef.current && isCurrentRun()) {
          markEpubPlaybackComplete()
          setActiveChunk(-1)
          maybeShowNudge()
        }
      } catch (err) {
        console.error(err)
        if (isCurrentRun()) {
          setPlayError(naturalFailureMessage(err))
          setOfferBuiltInFallback(instantUsable)
        }
      } finally {
        if (isCurrentRun()) {
          playbackRef.current = null
          setPipelineReady(false)
          setPlaying(false)
          setPaused(false)
          pausedRef.current = false
        }
      }
    },
    [
      chunks,
      document?.kind,
      document?.name,
      ensureEngine,
      handlePlaybackChunkStart,
      markEpubPlaybackComplete,
      maybeShowNudge,
      unlockAudio,
      voiceId,
      instantUsable,
    ],
  )

  const runPlayback = useCallback(
    async (startIndex = 0) => {
      // Always halt any in-flight pipeline first — chapter/section seeks used to
      // stack a second voice on top of the first.
      playbackRef.current?.stop()
      playbackRef.current = null
      setPipelineReady(false)
      try {
        window.speechSynthesis?.cancel()
      } catch {
        /* best-effort */
      }

      setPlayError(null)
      setDownloadNote(null)
      const playbackRun = playbackRunRef.current + 1
      playbackRunRef.current = playbackRun
      stoppedRef.current = false
      pausedRef.current = false
      setPlaying(true)
      setPaused(false)

      if (engine === 'webspeech') {
        await runWebSpeech(startIndex, playbackRun)
      } else {
        await runKokoro(startIndex, playbackRun)
      }
    },
    [engine, runKokoro, runWebSpeech],
  )

  const startIndexForChapter = useCallback(
    (chapterIndex) => chapterStartIndexes.get(chapterIndex) ?? 0,
    [chapterStartIndexes],
  )

  const startIndexForResume = useCallback(
    (position) => {
      const chapterStart = startIndexForChapter(position?.chapterIndex || 0)
      if (!position || position.optimized !== optimizeForSpeech) return chapterStart
      const matchingChunk = chunkRecords.findIndex(
        (chunk) =>
          chunk.chapterId === position.chapterId && chunk.endOffset > position.characterOffset,
      )
      return matchingChunk === -1 ? chapterStart : matchingChunk
    },
    [chunkRecords, optimizeForSpeech, startIndexForChapter],
  )

  const startListening = useCallback(
    (startIndex) => {
      if (!chunks.length) return
      if (engine !== 'webspeech') unlockAudio()
      if (!firstPlayTrackedRef.current) {
        firstPlayTrackedRef.current = true
        track(Events.FIRST_PLAY, { engine })
      }
      listenedChunksRef.current = 0
      void runPlayback(startIndex)
    },
    [chunks.length, engine, runPlayback, unlockAudio],
  )

  const resumeListening = useCallback(
    (position) => {
      if (!position) return false
      setSelectedChapterIndex(position.chapterIndex)
      setResumePosition(null)
      track(Events.EPUB_RESUME, { chapter: position.chapterIndex + 1 })
      startListening(startIndexForResume(position))
      return true
    },
    [startIndexForResume, startListening],
  )

  const onPlay = useCallback(() => {
    if (isEpub && browsingTarget?.chunkIndex != null) {
      const targetIndex = browsingTarget.chunkIndex
      setBrowsingTarget(null)
      setResumePosition(null)
      startListening(targetIndex)
      return
    }
    if (isEpub && resumeListening(resumePosition)) return
    startListening(isEpub ? startIndexForChapter(selectedChapterIndex) : 0)
  }, [browsingTarget, isEpub, resumeListening, resumePosition, selectedChapterIndex, startIndexForChapter, startListening])

  const onPlayFromBrowsingTarget = useCallback(() => {
    if (!browsingTarget) return
    const targetIndex = browsingTarget.chunkIndex
    setBrowsingTarget(null)
    setResumePosition(null)
    startListening(targetIndex)
  }, [browsingTarget, startListening])

  const onPause = useCallback(async () => {
    // Natural has nothing to pause until the pipeline exists. Pausing during
    // model/setup would leave the UI paused while runKokoro still resumes
    // AudioContext and starts playback.
    if (engine !== 'webspeech' && !playbackRef.current) return
    flushEpubProgress()
    pausedRef.current = true
    setPaused(true)
    if (engine === 'webspeech') {
      playbackRef.current?.pause?.()
      return
    }
    playbackRef.current?.pause?.()
    // Suspend the graph clock so the current chunk keeps its place; no gap on resume.
    try {
      await audioCtxRef.current?.suspend()
    } catch {
      /* ignore */
    }
  }, [engine, flushEpubProgress])

  const onResume = useCallback(async () => {
    pausedRef.current = false
    setPaused(false)
    if (engine === 'webspeech') {
      playbackRef.current?.resume?.()
      return
    }
    try {
      unlockAudio()
      await audioCtxRef.current?.resume()
      playbackRef.current?.resume?.()
    } catch {
      /* ignore */
    }
  }, [engine, unlockAudio])

  const onStop = useCallback(() => {
    stopPlayback()
    maybeShowNudge()
  }, [maybeShowNudge, stopPlayback])

  const onChapterChange = useCallback(
    (chapterIndex, playNow = false) => {
      if (!isEpub || chapterIndex < 0) return
      setSelectedChapterIndex(chapterIndex)
      setResumePosition(null)
      setPlayError(null)
      const index = startIndexForChapter(chapterIndex)
      const chapter = document?.chapters?.[chapterIndex]
      const target = {
        chunkIndex: index,
        chapterIndex,
        sectionId: null,
        label: chapter?.title || `Chapter ${chapterIndex + 1}`,
      }
      if (playNow) {
        setBrowsingTarget(null)
        startListening(index)
      } else {
        setBrowsingTarget(target)
      }
    },
    [document?.chapters, isEpub, startIndexForChapter, startListening],
  )

  const onSectionSeek = useCallback(
    (chapterIndex, section, playNow = false) => {
      if (!isEpub) return
      setSelectedChapterIndex(chapterIndex)
      setResumePosition(null)
      setPlayError(null)
      const index = chunkIndexForSection(chunkRecords, chapterIndex, section)
      const target = {
        chunkIndex: index,
        chapterIndex,
        sectionId: section?.id || null,
        label: section?.title || document?.chapters?.[chapterIndex]?.title || `Chapter ${chapterIndex + 1}`,
      }
      if (playNow) {
        setBrowsingTarget(null)
        startListening(index)
      } else {
        setBrowsingTarget(target)
      }
    },
    [chunkRecords, document?.chapters, isEpub, startListening],
  )

  const onChunkSeek = useCallback(
    (chunkIndex, playNow = false) => {
      if (!isEpub || chunkIndex == null || chunkIndex < 0) return
      const record = chunkRecords[chunkIndex]
      if (record) setSelectedChapterIndex(record.chapterIndex)
      setResumePosition(null)
      setPlayError(null)
      const chapter = document?.chapters?.[record?.chapterIndex]
      const section = nearestSection(chapter?.sections, record?.startOffset ?? 0)
      const target = {
        chunkIndex,
        chapterIndex: record?.chapterIndex ?? selectedChapterIndex,
        sectionId: section?.id || null,
        label: section?.title || chapter?.title || `Chapter ${(record?.chapterIndex ?? selectedChapterIndex) + 1}`,
      }
      if (playNow) {
        setBrowsingTarget(null)
        startListening(chunkIndex)
      } else {
        setBrowsingTarget(target)
      }
    },
    [chunkRecords, document?.chapters, isEpub, selectedChapterIndex, startListening],
  )

  const onPrevChapter = useCallback(() => {
    const baseIndex = playing && !paused ? activeChunk : browsingTarget?.chunkIndex ?? activeChunk
    const chapterIndex =
      baseIndex >= 0 ? chunkRecords[baseIndex]?.chapterIndex ?? selectedChapterIndex : selectedChapterIndex
    if (chapterIndex <= 0) return
    onChapterChange(chapterIndex - 1, playing && !paused)
  }, [activeChunk, browsingTarget, chunkRecords, onChapterChange, paused, playing, selectedChapterIndex])

  const onNextChapter = useCallback(() => {
    const baseIndex = playing && !paused ? activeChunk : browsingTarget?.chunkIndex ?? activeChunk
    const chapterIndex =
      baseIndex >= 0 ? chunkRecords[baseIndex]?.chapterIndex ?? selectedChapterIndex : selectedChapterIndex
    if (!document?.chapters || chapterIndex >= document.chapters.length - 1) return
    onChapterChange(chapterIndex + 1, playing && !paused)
  }, [activeChunk, browsingTarget, chunkRecords, document?.chapters, onChapterChange, paused, playing, selectedChapterIndex])

  const onPrevSection = useCallback(() => {
    if (!isEpub) return
    const baseIndex = playing && !paused ? activeChunk : browsingTarget?.chunkIndex ?? activeChunk
    const chapterIndex =
      baseIndex >= 0 ? chunkRecords[baseIndex]?.chapterIndex ?? selectedChapterIndex : selectedChapterIndex
    const chapter = document.chapters?.[chapterIndex]
    const offset = baseIndex >= 0 ? chunkRecords[baseIndex]?.startOffset ?? 0 : 0
    const prev = adjacentSection(chapter?.sections, offset, -1)
    if (prev) {
      onSectionSeek(chapterIndex, prev, playing && !paused)
      return
    }
    if (chapterIndex > 0) {
      const previousChapter = document.chapters[chapterIndex - 1]
      const previousSections = previousChapter?.sections || []
      const lastSection = previousSections[previousSections.length - 1]
      if (lastSection) onSectionSeek(chapterIndex - 1, lastSection, playing && !paused)
      else onChapterChange(chapterIndex - 1, playing && !paused)
    }
  }, [activeChunk, browsingTarget, chunkRecords, document?.chapters, isEpub, onChapterChange, onSectionSeek, paused, playing, selectedChapterIndex])

  const onNextSection = useCallback(() => {
    if (!isEpub) return
    const baseIndex = playing && !paused ? activeChunk : browsingTarget?.chunkIndex ?? activeChunk
    const chapterIndex =
      baseIndex >= 0 ? chunkRecords[baseIndex]?.chapterIndex ?? selectedChapterIndex : selectedChapterIndex
    const chapter = document.chapters?.[chapterIndex]
    const offset = baseIndex >= 0 ? chunkRecords[baseIndex]?.startOffset ?? 0 : 0
    const next = adjacentSection(chapter?.sections, offset, 1)
    if (next) {
      onSectionSeek(chapterIndex, next, playing && !paused)
      return
    }
    if (chapterIndex < (document.chapters?.length || 0) - 1) {
      const nextChapter = document.chapters[chapterIndex + 1]
      const firstSection = nextChapter?.sections?.[0]
      if (firstSection) onSectionSeek(chapterIndex + 1, firstSection, playing && !paused)
      else onChapterChange(chapterIndex + 1, playing && !paused)
    }
  }, [activeChunk, browsingTarget, chunkRecords, document?.chapters, isEpub, onChapterChange, onSectionSeek, paused, playing, selectedChapterIndex])

  const onOpenAnotherBook = () => {
    stopPlayback()
    setDocument(null)
    setEpubViewMode(EPUB_VIEW_READER)
    setSelectedChapterIndex(0)
    setBrowsingTarget(null)
    setResumePosition(null)
    setPlayError(null)
    setGenStats(null)
  }

  const onResumeBook = () => {
    resumeListening(resumePosition)
  }

  const onStartBookOver = () => {
    // Drop any debounced write first. stopPlayback() flushes pending progress,
    // which would otherwise restore the position we just cleared.
    markEpubPlaybackComplete()
    stopPlayback()
    setSelectedChapterIndex(0)
    setBrowsingTarget(null)
    setPlayError(null)
  }

  const onEngineChange = (next) => {
    if (next === engine) return
    if (next === 'kokoro' && naturalAvailable !== true) return
    stopPlayback()
    setGenStats(null)
    setPlayError(null)
    setOfferBuiltInFallback(false)
    setEngine(next)
    track(Events.ENGINE_SWITCH, { to: next })
  }

  const onEpubViewChange = (nextView) => {
    if (
      !isEpub ||
      (nextView !== EPUB_VIEW_LISTENING_ROOM && nextView !== EPUB_VIEW_READER) ||
      nextView === epubViewMode
    ) {
      return
    }
    setEpubViewMode(nextView)
    track(Events.EPUB_VIEW_SWITCH, { view: nextView })
  }

  const onUseBuiltInSpeech = (startPlaying = false) => {
    if (!instantUsable) return
    setOfferBuiltInFallback(false)
    setModelError(null)
    setPlayError(null)
    if (startPlaying) {
      onListenInstantly()
      return
    }
    onEngineChange('webspeech')
  }

  const onListenInstantly = () => {
    if (!instantUsable) return
    instantPlayRef.current = true
    if (engine === 'webspeech') {
      instantPlayRef.current = false
      onPlay()
      return
    }
    onEngineChange('webspeech')
  }

  useEffect(() => {
    if (!instantPlayRef.current || engine !== 'webspeech') return
    instantPlayRef.current = false
    onPlay()
    // Start after the Instant engine is selected; onPlay reads the latest chunks/resume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine])

  const onKokoroVoiceChange = (id) => {
    setVoiceId(id)
    // Load the style embedding as a Cache API asset only. Do not enqueue
    // worker generate() here: that shares the synthesis queue, and a stall
    // (uncached voice or punctuation-only inference) blocks all later playback.
    void ensureVoiceBinCached(id).catch((err) => console.error(err))
  }

  const onWebSpeechVoiceChange = (uri) => {
    setWebSpeechVoiceURI(uri || null)
  }

  const onSpeedChange = (rate) => {
    setSpeedState(rate)
    speedRef.current = rate
    playbackRef.current?.setSpeed(rate)
  }

  const onDownloadAudioChange = (checked) => {
    setDownloadAudio(checked)
    downloadAudioRef.current = checked
  }

  const onOptimizeForSpeechChange = (checked) => {
    // Changing speech text rebuilds chunks; clear any mid-book highlight/session
    // so we never paint an old index onto a new chunk list.
    if (playing || paused || activeChunk >= 0) stopPlayback()
    setBrowsingTarget(null)
    setOptimizeForSpeech(checked)
    track(Events.TTS_FORMAT_TOGGLE, { enabled: checked })
  }

  const onFile = async (file) => {
    setIngestError(null)
    setIngestBusy(true)
    stopPlayback()
    try {
      const doc = await extractFromFile(file)
      applyDocument(doc)
      track(Events.DOCUMENT_LOADED, { source: 'file', kind: doc.kind })
    } catch (err) {
      setIngestError(err?.message || 'Could not read that file.')
      setDocument(null)
      setEpubViewMode(EPUB_VIEW_READER)
      setSelectedChapterIndex(0)
      setResumePosition(null)
    } finally {
      setIngestBusy(false)
    }
  }

  const openPastedText = useCallback(
    (raw) => {
      const doc = extractFromPaste(raw)
      setIngestError(null)
      stopPlayback()
      applyDocument(doc)
      setPaste(typeof raw === 'string' ? raw : '')
      track(Events.DOCUMENT_LOADED, { source: 'paste', kind: doc.kind })
      return { kind: doc.kind, name: doc.name }
    },
    [applyDocument, stopPlayback],
  )

  const onPasteSubmit = (e) => {
    e.preventDefault()
    try {
      openPastedText(paste)
    } catch (err) {
      setIngestError(err?.message || 'Nothing to read.')
    }
  }

  const onTrySample = () => {
    setIngestError(null)
    stopPlayback()
    const doc = sampleDocument()
    applyDocument(doc)
    track(Events.DOCUMENT_LOADED, { source: 'sample', kind: doc.kind })
  }

  // Two OS-level entry points into a document, both landing here once on
  // mount: (1) File Handling API -- an installed PWA opened via "Open with
  // Junco Reader" / a double-clicked .pdf; (2) Web Share Target -- shared
  // from another app's share sheet, staged by public/sw.js and handed off
  // via the ?shared=1 redirect (see src/lib/incomingShare.js).
  useEffect(() => {
    let cancelled = false

    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (launchParams) => {
        if (cancelled || !launchParams.files?.length) return
        try {
          const file = await launchParams.files[0].getFile()
          if (!cancelled) onFile(file)
        } catch (err) {
          console.error(err)
        }
      })
    }

    if (hasIncomingShareParam()) {
      ;(async () => {
        const sharedFile = await takeSharedFile()
        if (cancelled) return
        if (sharedFile) {
          onFile(sharedFile)
        } else {
          const shared = await takeSharedText()
          if (cancelled) return
          const text = [shared?.title, shared?.text, shared?.url].filter(Boolean).join('\n\n')
          if (text.trim()) {
            setIngestError(null)
            stopPlayback()
            try {
              const doc = extractFromPaste(text)
              applyDocument(doc)
              track(Events.DOCUMENT_LOADED, { source: 'share_target', kind: doc.kind })
            } catch (err) {
              setIngestError(err?.message || 'Nothing to read.')
            }
          }
        }
        clearShareParamFromUrl()
      })()
    }

    return () => {
      cancelled = true
    }
    // Mount-once: onFile/stopPlayback are stable enough for a launch handoff
    // that can only ever fire once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const activeChunkRecord = activeChunk >= 0 ? chunkRecords[activeChunk] : null
  const browsingChunkRecord = browsingTarget?.chunkIndex != null ? chunkRecords[browsingTarget.chunkIndex] : null
  const previewChapterIndex = isEpub
    ? browsingTarget?.chapterIndex ?? activeChunkRecord?.chapterIndex ?? selectedChapterIndex
    : 0
  const previewChapterChunks = useMemo(() => {
    if (!isEpub) return []
    const chapterChunks = []
    chunkRecords.forEach((chunk, globalIndex) => {
      if (chunk.chapterIndex !== previewChapterIndex) return
      chapterChunks.push({ ...chunk, globalIndex, localIndex: chapterChunks.length })
    })
    return chapterChunks
  }, [chunkRecords, isEpub, previewChapterIndex])
  const previewChunks = isEpub ? previewChapterChunks.map((chunk) => chunk.text) : chunks
  const previewActiveChunkIndex = isEpub
    ? activeChunkRecord?.chapterIndex === previewChapterIndex
      ? activeChunk
      : -1
    : activeChunk
  const previewSelectedChunkIndex =
    isEpub && browsingTarget?.chapterIndex === previewChapterIndex
      ? browsingTarget.chunkIndex
      : -1
  const currentEpubChunk =
    (playing || paused ? activeChunkRecord : browsingChunkRecord || activeChunkRecord) ||
    chunkRecords[chapterStartIndexes.get(selectedChapterIndex) ?? 0]
  const currentEpubPercent = isEpub
    ? bookProgressPercent(
        epubChapterLengths,
        currentEpubChunk?.chapterIndex ?? selectedChapterIndex,
        currentEpubChunk?.startOffset ?? 0,
      )
    : 0
  const resumeChapter = isEpub && resumePosition ? document.chapters?.[resumePosition.chapterIndex] : null
  const resumePercent = resumePosition
    ? bookProgressPercent(epubChapterLengths, resumePosition.chapterIndex, resumePosition.characterOffset)
    : 0
  const resumeAtChapterStart = Boolean(
    resumePosition && resumePosition.optimized !== optimizeForSpeech,
  )
  const chapterNavigationLabel = isEpub
    ? `Chapter ${previewChapterIndex + 1} of ${document.chapters.length} · ${currentEpubPercent}% through book`
    : null

  const progressLabel =
    playing || paused
      ? isEpub
        ? `Chapter ${(currentEpubChunk?.chapterIndex ?? selectedChapterIndex) + 1} of ${document.chapters.length} · ${currentEpubPercent}%${paused ? ' / paused' : ''}`
        : `Chunk ${Math.max(activeChunk, 0) + 1} of ${chunks.length}${paused ? ' / paused' : ''}`
      : null

  // Whether audio is collected is fixed for the life of a playback session, so
  // turning this on mid-session would silently do nothing. Turning it off is
  // still allowed -- that stops the in-progress collection. Kokoro-only: Web
  // Speech utterances never expose raw PCM to the page.
  const downloadAudioLocked = playing && !downloadAudio

  const engineReady =
    engine === 'webspeech' ? instantUsable : naturalAvailable === true && modelStatus === 'ready'
  const readyHint = noSupportedSpeech
    ? NO_SUPPORTED_SPEECH_HINT
    : engine === 'webspeech'
      ? !WEB_SPEECH_SUPPORTED
        ? "Your browser doesn't support built-in speech."
        : !instantVoicesReady
          ? LOCAL_VOICE_CHECKING_HINT
          : instantUsable
            ? null
            : LOCAL_VOICE_UNAVAILABLE_HINT
      : naturalAvailable == null
        ? NATURAL_CHECKING_HINT
        : naturalAvailable === false
          ? availabilityHint
          : modelStatus !== 'ready'
            ? instantUsable
              ? 'Download the Natural voice to start listening, or use Instant.'
              : 'Download the Natural voice to start listening.'
            : null

  const canPause = engine === 'webspeech' || pipelineReady

  webmcpActionsRef.current = {
    getStatus: () => ({
      hasDocument: Boolean(document),
      documentKind: document?.kind ?? null,
      documentName: document?.name ?? null,
      bookTitle: document?.meta?.title ?? null,
      engine: engine === 'kokoro' ? 'natural' : 'instant',
      modelStatus,
      naturalAvailable,
      instantUsable,
      engineReady,
      playing,
      paused,
      speed,
      voice: engine === 'kokoro' ? voiceId : webSpeechVoiceURI,
      instantVoices: engine === 'webspeech'
        ? webSpeechVoices.map((voice) => ({ name: voice.name, voiceURI: voice.voiceURI }))
        : undefined,
      chapter: isEpub ? selectedChapterIndex + 1 : null,
      chapterCount: isEpub ? document.chapters?.length ?? 0 : null,
      progressPercent: isEpub ? currentEpubPercent : null,
      hasResume: Boolean(resumePosition),
      ingestBusy,
      canPause,
    }),
    loadSample: () => {
      onTrySample()
      return { kind: 'txt', name: SAMPLE_DOCUMENT_NAME }
    },
    openPastedText,
    setEngine: (next) => {
      const mapped = next === 'natural' ? 'kokoro' : next === 'instant' ? 'webspeech' : next
      if (mapped !== 'kokoro' && mapped !== 'webspeech') {
        throw new Error('Engine must be "natural" or "instant".')
      }
      if (mapped === 'kokoro' && naturalAvailable !== true) {
        throw new Error(availabilityHint || NATURAL_UNAVAILABLE_HINT)
      }
      if (mapped === 'webspeech' && !instantUsable) {
        throw new Error(LOCAL_VOICE_UNAVAILABLE_HINT)
      }
      onEngineChange(mapped)
      return { engine: mapped === 'kokoro' ? 'natural' : 'instant' }
    },
    setVoice: (voice) => {
      const query = String(voice || '').trim()
      if (!query) throw new Error('Provide a voice id, name, or voiceURI.')
      if (engine === 'kokoro') {
        const match =
          VOICES.find((item) => item.id === query) ||
          VOICES.find((item) => item.displayName.toLowerCase() === query.toLowerCase())
        if (!match) throw new Error(`Unknown Natural voice "${query}".`)
        onKokoroVoiceChange(match.id)
        return { engine: 'natural', voice: match.id, displayName: match.displayName }
      }
      const match =
        webSpeechVoices.find((item) => item.voiceURI === query) ||
        webSpeechVoices.find((item) => item.name === query) ||
        webSpeechVoices.find((item) => item.name?.toLowerCase() === query.toLowerCase())
      if (!match) throw new Error(`Unknown Instant voice "${query}".`)
      onWebSpeechVoiceChange(match.voiceURI)
      return { engine: 'instant', voice: match.voiceURI, displayName: match.name }
    },
    setSpeed: (speedValue) => {
      const rate = Number(speedValue)
      if (!SPEED_OPTIONS.includes(rate)) {
        throw new Error(`Speed must be one of ${SPEED_OPTIONS.join(', ')}.`)
      }
      onSpeedChange(rate)
      return { speed: rate }
    },
    downloadNaturalModel: async () => {
      if (naturalAvailable !== true) {
        throw new Error(availabilityHint || NATURAL_UNAVAILABLE_HINT)
      }
      if (modelStatus === 'ready' && getLoadedMeta().device) {
        return { modelStatus: 'ready', note: 'Natural voice is already on this device.' }
      }
      await handleDownload()
      if (!getLoadedMeta().device) {
        throw new Error('Natural voice did not finish downloading.')
      }
      return { modelStatus: 'ready' }
    },
    clearNaturalModel: async () => {
      const removed = await handleRemoveModel()
      if (!removed) {
        throw new Error('Natural voice model was not removed.')
      }
      return { modelStatus: 'needed' }
    },
    play: async () => {
      if (!document) throw new Error('Open a document or paste text before playing.')
      if (!chunks.length) throw new Error('This document has no readable text.')
      if (playing && paused) {
        await onResume()
        return { playing: true, paused: false }
      }
      if (playing && !paused) return { playing: true, paused: false }
      if (!engineReady) throw new Error(readyHint || 'Voice engine is not ready.')
      onPlay()
      return { playing: true }
    },
    pause: async () => {
      if (!playing || paused) throw new Error('Nothing is playing.')
      if (!canPause) throw new Error('Wait until playback is ready before pausing.')
      await onPause()
      return { paused: true }
    },
    stop: () => {
      onStop()
      return { playing: false, paused: false }
    },
    listChapters: () => epubChapterListing(document),
    seekChapter: ({ chapter, playNow }) => {
      if (document?.kind !== 'epub') throw new Error('Open an EPUB to seek chapters.')
      const index = Number(chapter) - 1
      if (!Number.isInteger(index) || index < 0 || index >= (document.chapters?.length || 0)) {
        throw new Error(`Chapter ${chapter} is out of range.`)
      }
      onChapterChange(index, Boolean(playNow))
      return {
        chapter: index + 1,
        title: document.chapters[index].title,
        playing: Boolean(playNow),
      }
    },
    playFromSection: ({ chapter, sectionId, sectionTitle }) => {
      if (document?.kind !== 'epub') throw new Error('Open an EPUB to play a section.')
      const index = Number(chapter) - 1
      const chapterRecord = document.chapters?.[index]
      if (!chapterRecord) throw new Error(`Chapter ${chapter} is out of range.`)
      const sections = chapterRecord.sections || []
      let section = null
      if (sectionId) section = sections.find((item) => item.id === sectionId) || null
      if (!section && sectionTitle) {
        const needle = String(sectionTitle).trim().toLowerCase()
        section = sections.find((item) => item.title?.toLowerCase() === needle) || null
      }
      if (!sectionId && !sectionTitle) {
        onChapterChange(index, true)
        return { chapter: index + 1, title: chapterRecord.title, playing: true }
      }
      if (!section) throw new Error('Could not find that section in the chapter.')
      onSectionSeek(index, section, true)
      return {
        chapter: index + 1,
        sectionId: section.id,
        sectionTitle: section.title,
        playing: true,
      }
    },
    resumeSaved: () => {
      if (!resumePosition) throw new Error('No saved position for this book.')
      onResumeBook()
      return { chapter: resumePosition.chapterIndex + 1 }
    },
    clearSaved: () => {
      if (document?.kind === 'epub' && document.meta?.fingerprint) {
        clearEpubProgress(document.meta.fingerprint)
      }
      setResumePosition(null)
      return { hasResume: false }
    },
  }

  useWebMcpTools(webmcpActionsRef, {
    hasDocument: Boolean(document),
    isEpub,
  })

  const voicePickerProps = {
    engine,
    onEngineChange,
    webSpeechSupported: WEB_SPEECH_SUPPORTED,
    instantUsable,
    instantVoicesReady,
    naturalAvailable,
    naturalUnavailableHint: availabilityHint || NATURAL_CHECKING_HINT,
    instantEmptyHint: noSupportedSpeech
      ? NO_SUPPORTED_SPEECH_HINT
      : !instantVoicesReady
        ? LOCAL_VOICE_CHECKING_HINT
        : LOCAL_VOICE_UNAVAILABLE_HINT,
    kokoroVoiceId: voiceId,
    onKokoroVoiceChange,
    webSpeechVoices,
    webSpeechVoiceURI,
    onWebSpeechVoiceChange,
    disabled: playing,
  }

  const modelDownloadProps =
    engine === 'kokoro'
      ? {
          status: modelStatus === 'unknown' ? 'needed' : modelStatus,
          progress: modelProgress,
          displaySize,
          deviceLabel,
          error: modelError,
          onDownload: handleDownload,
          onRemove: handleRemoveModel,
          removing: removingModel,
          disabled: removingModel,
          unavailableTitle:
            naturalAvailable == null ? 'Checking Natural voice' : 'Natural voice unavailable',
          unavailableReason:
            naturalAvailable === true
              ? null
              : naturalAvailable == null
                ? NATURAL_CHECKING_HINT
                : availabilityHint,
          onUseBuiltIn: instantUsable
            ? () => onUseBuiltInSpeech(Boolean(playError || offerBuiltInFallback))
            : undefined,
        }
      : null

  const playErrorNode = playError ? (
    <p className="jr-error">
      {playError}
      {offerBuiltInFallback && instantUsable ? (
        <>
          {' '}
          <button type="button" className="jr-error-fallback" onClick={() => onUseBuiltInSpeech(true)}>
            Use built-in speech
          </button>
        </>
      ) : null}
    </p>
  ) : null

  useEffect(() => {
    if (!document) return undefined
    const onKey = (event) => {
      if (!isGlobalPlaybackShortcut(event)) return
      event.preventDefault()
      if (!playing) {
        if (engineReady && chunks.length && !ingestBusy) onPlay()
      } else if (paused) {
        onResume()
      } else if (canPause) {
        onPause()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canPause, chunks.length, document, engineReady, ingestBusy, onPause, onPlay, onResume, paused, playing])

  // Hardware/OS media keys (play-pause, previous/next track on a keyboard or
  // headset) route through the Media Session API, not keydown events -- and
  // Chromium generally only grants a page audio focus for that once it holds
  // a real <audio>/<video> element, which neither the Web Audio graph (Kokoro)
  // nor speechSynthesis (Web Speech) provides on their own. The silent,
  // looping <audio id="jr-media-anchor"> element below exists purely to give
  // the browser something to anchor media-key routing to.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined
    const session = navigator.mediaSession
    const actions = [
      ['play', () => (paused ? onResume() : onPlay())],
      ['pause', () => onPause()],
      ['stop', () => onStop()],
      ['previoustrack', () => onPrevChapter()],
      ['nexttrack', () => onNextChapter()],
    ]
    for (const [action, handler] of actions) {
      try {
        session.setActionHandler(action, handler)
      } catch {
        /* action unsupported in this browser */
      }
    }
    return () => {
      for (const [action] of actions) {
        try {
          session.setActionHandler(action, null)
        } catch {
          /* ignore */
        }
      }
    }
  }, [paused, onPlay, onPause, onResume, onStop, onPrevChapter, onNextChapter])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession || !isEpub || !document) return
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: document.chapters?.[previewChapterIndex]?.title || document.meta?.title || document.name,
        artist: document.meta?.creator || 'Junco Reader',
        album: document.meta?.title || document.name,
      })
    } catch {
      /* MediaMetadata unavailable */
    }
  }, [isEpub, document, previewChapterIndex])

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return
    navigator.mediaSession.playbackState = !playing ? 'none' : paused ? 'paused' : 'playing'
  }, [playing, paused])

  useEffect(() => {
    const el = mediaAnchorRef.current
    if (!el) return undefined
    const objectUrl = URL.createObjectURL(createSilentWavBlob())
    el.src = objectUrl
    el.load()
    return () => {
      el.removeAttribute('src')
      el.load()
      URL.revokeObjectURL(objectUrl)
    }
  }, [])

  useEffect(() => {
    const el = mediaAnchorRef.current
    if (!el) return
    if (playing && !paused) {
      el.play().catch(() => {
        /* autoplay of the silent anchor can fail before any user gesture; the
           real narration audio already has one by the time playback starts */
      })
    } else {
      el.pause()
    }
  }, [playing, paused])

  return (
    <div className={`jr-app${isListeningRoomView ? ' has-listening-room' : ''}`}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {!bannerDismissed && (noSupportedSpeech || (capabilityMsg && engine === 'kokoro')) ? (
        <CapabilityBanner
          message={noSupportedSpeech ? NO_SUPPORTED_SPEECH_HINT : capabilityMsg}
          onDismiss={() => setBannerDismissed(true)}
        />
      ) : null}

      <header className={`jr-nav${isEpub ? ' has-epub-toggle' : ''}`}>
        <a className="jr-nav-brand" href={MARKETING_URL} target="_blank" rel="noopener noreferrer">
          <img
            className="jr-nav-logo"
            src="/junco-app-logo.webp"
            alt=""
            width="32"
            height="32"
          />
          <span className="jr-nav-name">
            Junco <em>Reader</em>
          </span>
        </a>
        {isEpub ? <EpubViewToggle value={epubViewMode} onChange={onEpubViewChange} /> : null}
        <p className="jr-nav-privacy">Free / private / in your browser</p>
      </header>

      <main id="main" className={`jr-main${isListeningRoomView ? ' is-listening-room' : ''}`}>
        {isListeningRoomView ? (
          <>
            {ingestBusy ? <p className="jr-status">Extracting text...</p> : null}
            {ingestError ? <p className="jr-error">{ingestError}</p> : null}
            <ListeningRoom
              document={document}
              chunkRecords={chunkRecords}
              chapterLengths={epubChapterLengths}
              chapterChunks={previewChapterChunks}
              previewChapterIndex={previewChapterIndex}
              activeChunkIndex={activeChunk}
              activeChunkRecord={activeChunkRecord}
              browsingTarget={browsingTarget}
              bookPercent={currentEpubPercent}
              progressLabel={progressLabel}
              playing={playing}
              paused={paused}
              genStats={engine === 'kokoro' ? genStats : null}
              engineReady={engineReady}
              readyHint={readyHint}
              ingestBusy={ingestBusy}
              resumePosition={resumePosition}
              resumeChapter={resumeChapter}
              resumePercent={resumePercent}
              resumeAtChapterStart={resumeAtChapterStart}
              onOpenAnother={onOpenAnotherBook}
              onChapterSelect={onChapterChange}
              onSectionSeek={onSectionSeek}
              onChunkSeek={onChunkSeek}
              onPlay={onPlay}
              onPlayFromBrowsingTarget={onPlayFromBrowsingTarget}
              onPause={onPause}
              onResume={onResume}
              onStop={onStop}
              onResumeBook={onResumeBook}
              onStartOver={onStartBookOver}
              onPrevChapter={onPrevChapter}
              onNextChapter={onNextChapter}
              onPrevSection={onPrevSection}
              onNextSection={onNextSection}
              voiceProps={voicePickerProps}
              speed={speed}
              onSpeedChange={onSpeedChange}
              onListenInstantly={instantUsable ? onListenInstantly : undefined}
              canPause={canPause}
              modelDownloadProps={modelDownloadProps}
              optimizeForSpeech={optimizeForSpeech}
              onOptimizeForSpeechChange={onOptimizeForSpeechChange}
            />
            {playErrorNode}
          </>
        ) : (
          <>
            <section className="jr-hero">
              <h1 className="jr-brand">
                Junco <em>Reader</em>
              </h1>
              <p className="jr-lede">
                Read PDFs, EPUBs, and text out loud in your browser. Junco does not upload or
                persist document contents.
              </p>
            </section>

            <section className="jr-panel">
              <DropZone onFile={onFile} disabled={ingestBusy} />

              <form className="jr-paste" onSubmit={onPasteSubmit}>
                <label className="jr-paste-label" htmlFor="jr-paste">
                  Or paste text / Markdown
                </label>
                <textarea
                  id="jr-paste"
                  className="jr-paste-input"
                  rows={4}
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  placeholder="Paste an article, notes, or Markdown..."
                />
                <button type="submit" className="jr-btn jr-btn-ghost" disabled={!paste.trim()}>
                  Use pasted text
                </button>
              </form>

              <p className="jr-sample-cta">
                Nothing to paste yet?{' '}
                <button
                  type="button"
                  className="jr-sample-link"
                  onClick={onTrySample}
                  disabled={ingestBusy}
                >
                  Try a 30-second sample
                </button>
              </p>

              {ingestBusy ? <p className="jr-status">Extracting text...</p> : null}
              {ingestError ? <p className="jr-error">{ingestError}</p> : null}
            </section>

            {document ? (
              <section className="jr-workspace">
                <DocumentPreview
                  document={document}
                  chunks={previewChunks}
                  chapterChunks={previewChapterChunks}
                  activeChunkIndex={previewActiveChunkIndex}
                  selectedChunkIndex={previewSelectedChunkIndex}
                  chapterIndex={previewChapterIndex}
                  onChapterChange={onChapterChange}
                  onSectionSelect={(section) => onSectionSeek(previewChapterIndex, section)}
                  onChunkSeek={onChunkSeek}
                  bookProgressLabel={chapterNavigationLabel}
                  optimizeForSpeech={optimizeForSpeech}
                  onOptimizeForSpeechChange={onOptimizeForSpeechChange}
                  speechToggleLocked={playing || paused}
                />

                <div className="jr-controls">
                  {isEpub ? (
                    <PlaybackTargetNotice
                      target={browsingTarget}
                      playing={playing}
                      paused={paused}
                      ready={engineReady}
                      onPlayFromHere={onPlayFromBrowsingTarget}
                      className="is-reader"
                    />
                  ) : null}
                  <div className="jr-controls-row">
                    <VoicePicker {...voicePickerProps} />
                    <SpeedControl value={speed} onChange={onSpeedChange} />
                    <Player
                      ready={engineReady}
                      readyHint={readyHint}
                      playing={playing}
                      paused={paused}
                      canPause={canPause}
                      progressLabel={progressLabel}
                      onPlay={onPlay}
                      onPause={onPause}
                      onResume={onResume}
                      onStop={onStop}
                      disabled={!chunks.length || ingestBusy}
                    />
                  </div>

                  {modelDownloadProps ? <ModelDownloadButton {...modelDownloadProps} /> : null}

                  {engine === 'kokoro' ? (
                    <div className="jr-options" role="group" aria-label="Generation options">
                      <label
                        className={`jr-option ${downloadAudioLocked ? 'is-disabled' : ''}`}
                        title={
                          downloadAudioLocked
                            ? 'Enable before pressing Listen — this session already started without it.'
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={downloadAudio}
                          disabled={downloadAudioLocked}
                          onChange={(e) => onDownloadAudioChange(e.target.checked)}
                        />
                        <span className="jr-option-copy">
                          <span className="jr-option-title">Download audio</span>
                          <span className="jr-option-hint">
                            Save a WAV when listening finishes (up to{' '}
                            {Math.round(MAX_DOWNLOAD_AUDIO_SECONDS / 60)} min)
                          </span>
                        </span>
                      </label>
                    </div>
                  ) : null}

                  {playErrorNode}
                  {downloadNote ? <p className="jr-status">{downloadNote}</p> : null}
                  {engine === 'kokoro' && genStats ? <GenerationStats stats={genStats} /> : null}
                </div>
              </section>
            ) : null}
          </>
        )}

        <section className="jr-footnote">
          <p className="jr-kicker">Free browser tool</p>
          <p>
            Junco does not upload or persist document contents. Instant uses only browser voices
            reported as local; Natural fetches model and runtime assets, then synthesizes
            client-side.{' '}
            <a href={MARKETING_URL} target="_blank" rel="noopener noreferrer">
              Junco
            </a>{' '}
            turns newsletters into a daily podcast on iPhone with the same family of voices.
          </p>
        </section>
      </main>

      <audio ref={mediaAnchorRef} loop preload="auto" style={{ display: 'none' }} />

      <AppStoreCta />
      <PostListenNudge
        open={nudgeOpen}
        engine={engine}
        naturalAvailable={naturalAvailable}
        onTryNatural={() => onEngineChange('kokoro')}
        onClose={() => setNudgeOpen(false)}
      />
    </div>
  )
}
