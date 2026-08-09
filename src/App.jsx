import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import AppStoreCta from './components/AppStoreCta'
import CapabilityBanner from './components/CapabilityBanner'
import DocumentPreview from './components/DocumentPreview'
import DropZone from './components/DropZone'
import GenerationStats from './components/GenerationStats'
import ModelDownloadButton from './components/ModelDownloadButton'
import Player from './components/Player'
import PostListenNudge, { hasSeenNudge, markNudgeSeen } from './components/PostListenNudge'
import SpeedControl from './components/SpeedControl'
import VoicePicker from './components/VoicePicker'

import { getCapabilityMessage } from './lib/capability'
import { chunkTextWithOffsets } from './lib/chunkText'
import { downloadWav, MAX_DOWNLOAD_AUDIO_SECONDS } from './lib/encodeWav'
import { clearEpubProgress, loadEpubProgress, saveEpubProgress } from './lib/epubProgress'
import { extractFromFile, extractFromPaste } from './lib/extractText'
import { formatForTts } from './lib/formatForTts'
import {
  DEFAULT_DISPLAY_SIZE,
  clearModelCache,
  isModelCached,
  loadManifest,
} from './lib/modelCache'
import {
  chooseRuntime,
  readCompatibilityMode,
  runtimeFromMeta,
  writeCompatibilityMode,
} from './lib/kokoroEngine'
import {
  getLoadedMeta,
  loadKokoro,
  prefetchVoice,
  unloadKokoro,
  warmUp,
} from './lib/kokoroWorkerClient'
import { runPipelinedPlayback } from './lib/playbackPipeline'
import {
  getWebSpeechVoices,
  isWebSpeechSupported,
  preferredDefaultVoice,
  runWebSpeechPlayback,
} from './lib/webSpeechEngine'
import { sampleDocument } from './lib/sampleDocument'
import {
  clearShareParamFromUrl,
  hasIncomingShareParam,
  takeSharedFile,
  takeSharedText,
} from './lib/incomingShare'
import { DEFAULT_VOICE_ID, voiceById } from './lib/voices'
import { MARKETING_URL } from './lib/appStore'
import { Events, track } from './lib/analytics'

import './App.css'

const WEB_SPEECH_SUPPORTED = isWebSpeechSupported()

function bookProgressPercent(chapters, chapterIndex, characterOffset) {
  if (!chapters?.length) return 0
  const total = chapters.reduce((sum, chapter) => sum + chapter.text.length, 0)
  if (!total) return 0
  const before = chapters
    .slice(0, Math.max(0, chapterIndex))
    .reduce((sum, chapter) => sum + chapter.text.length, 0)
  return Math.min(100, Math.max(0, Math.round(((before + characterOffset) / total) * 100)))
}

export default function App() {
  const [document, setDocument] = useState(null)
  const [paste, setPaste] = useState('')
  const [ingestError, setIngestError] = useState(null)
  const [ingestBusy, setIngestBusy] = useState(false)

  // Kokoro (Natural) is the default: it's the flagship voice quality and the
  // same on-device model family as the iOS app. Web Speech (Instant) stays
  // available as a zero-download fallback, e.g. where Kokoro can't run.
  const [engine, setEngine] = useState('kokoro')
  const [webSpeechVoices, setWebSpeechVoices] = useState([])
  const [webSpeechVoiceURI, setWebSpeechVoiceURI] = useState(null)

  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [speed, setSpeedState] = useState(1)
  const [downloadAudio, setDownloadAudio] = useState(false)
  const [optimizeForSpeech, setOptimizeForSpeech] = useState(false)
  const [modelStatus, setModelStatus] = useState('unknown') // unknown | needed | downloading | loading | ready
  const [modelProgress, setModelProgress] = useState(0)
  const [modelError, setModelError] = useState(null)
  const [displaySize, setDisplaySize] = useState(DEFAULT_DISPLAY_SIZE)
  const [deviceLabel, setDeviceLabel] = useState(null)
  const [removingModel, setRemovingModel] = useState(false)
  const [compatibilityMode, setCompatibilityMode] = useState(() => readCompatibilityMode())
  const [switchingRuntime, setSwitchingRuntime] = useState(false)

  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [activeChunk, setActiveChunk] = useState(-1)
  const [playError, setPlayError] = useState(null)
  const [downloadNote, setDownloadNote] = useState(null)

  const [capabilityMsg, setCapabilityMsg] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [genStats, setGenStats] = useState(null)
  const [selectedChapterIndex, setSelectedChapterIndex] = useState(0)
  const [resumePosition, setResumePosition] = useState(null)

  const audioCtxRef = useRef(null)
  const playbackRef = useRef(null) // { setSpeed, stop, done } from either engine
  const stoppedRef = useRef(false)
  const speedRef = useRef(1)
  const downloadAudioRef = useRef(false)
  const runtimeRef = useRef(null) // cached chooseRuntime() result
  const listenedChunksRef = useRef(0)
  const statsThrottleRef = useRef(0)
  const modelProgressThrottleRef = useRef(0)
  const modelLoadStartedRef = useRef(false)
  const runtimeSwitchingRef = useRef(false)
  const runtimeVersionRef = useRef(0)
  const firstPlayTrackedRef = useRef(false)
  const playbackRunRef = useRef(0)

  const isEpub = document?.kind === 'epub'
  const chunkRecords = useMemo(() => {
    if (!document?.text) return []

    if (document.kind === 'epub') {
      return (document.chapters || []).flatMap((chapter, chapterIndex) => {
        const speechText = optimizeForSpeech ? formatForTts(chapter.text) : chapter.text
        return chunkTextWithOffsets(speechText).map((chunk) => ({
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

  const chapterStartIndexes = useMemo(() => {
    const starts = new Map()
    chunkRecords.forEach((chunk, index) => {
      if (!starts.has(chunk.chapterIndex)) starts.set(chunk.chapterIndex, index)
    })
    return starts
  }, [chunkRecords])

  useEffect(() => {
    let cancelled = false
    const initialRuntimeVersion = runtimeVersionRef.current
    ;(async () => {
      const [manifest, cap, runtime, webSpeechVoiceList] = await Promise.all([
        loadManifest(),
        getCapabilityMessage(),
        chooseRuntime({ compatibilityMode: readCompatibilityMode() }),
        getWebSpeechVoices(),
      ])
      if (cancelled) return

      // These results are independent of the Natural-voice runtime. Populate
      // them even when the user starts a model load before the initial cache
      // probe finishes so Instant voices remain available.
      setCapabilityMsg(cap)
      setWebSpeechVoices(webSpeechVoiceList)
      const preferred = preferredDefaultVoice(webSpeechVoiceList)
      if (preferred) setWebSpeechVoiceURI(preferred.voiceURI)

      if (runtimeVersionRef.current !== initialRuntimeVersion || modelLoadStartedRef.current) return
      runtimeRef.current = runtime
      const cached = await isModelCached(runtime)
      if (cancelled || runtimeVersionRef.current !== initialRuntimeVersion || modelLoadStartedRef.current) {
        return
      }
      setDisplaySize(runtime.displaySize || manifest?.displaySize || DEFAULT_DISPLAY_SIZE)
      setDeviceLabel(runtime.note)
      // A user can reach the download button before this first capability
      // probe finishes. Once an explicit load starts, its result is the only
      // source of truth for model status; the late cache probe must not reset
      // the UI after a successful first download.
      if (!modelLoadStartedRef.current) setModelStatus(cached ? 'ready' : 'needed')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const ensureAudio = () => {
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
  }

  const ensureRuntime = useCallback(async () => {
    if (!runtimeRef.current) runtimeRef.current = await chooseRuntime()
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
    if (runtimeSwitchingRef.current || removingModel) return
    modelLoadStartedRef.current = true
    track(Events.MODEL_DOWNLOAD_START)
    setModelError(null)
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
      await warmUp(voiceId)
      const actualRuntime = runtimeFromMeta(meta)
      runtimeRef.current = actualRuntime
      setDisplaySize(actualRuntime.displaySize)
      setDeviceLabel(actualRuntime.note)
      setModelProgress(100)
      setModelStatus('ready')
      track(Events.MODEL_DOWNLOAD_COMPLETE, { device: meta.device, dtype: meta.dtype })
    } catch (err) {
      console.error(err)
      setModelStatus('needed')
      setModelError(err?.message || 'Download failed. Check your connection and try again.')
    }
  }, [ensureRuntime, removingModel, reportModelProgress, voiceId])

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
    await warmUp(voiceId)
    const actualRuntime = runtimeFromMeta(meta)
    runtimeRef.current = actualRuntime
    setDisplaySize(actualRuntime.displaySize)
    setDeviceLabel(actualRuntime.note)
    setModelStatus('ready')
    return meta
  }, [ensureRuntime, reportModelProgress, voiceId])

  const stopPlayback = useCallback(() => {
    playbackRunRef.current += 1
    stoppedRef.current = true
    playbackRef.current?.stop()
    playbackRef.current = null
    setPlaying(false)
    setPaused(false)
    setActiveChunk(-1)
    try {
      if (audioCtxRef.current?.state === 'running') audioCtxRef.current.suspend()
    } catch {
      /* ignore */
    }
  }, [])

  const applyDocument = useCallback((nextDocument) => {
    setDocument(nextDocument)
    setGenStats(null)
    setActiveChunk(-1)
    setSelectedChapterIndex(0)
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
      if (document?.kind !== 'epub' || !document.meta?.fingerprint) return
      const chunk = chunkRecords[index]
      if (!chunk?.chapterId) return
      saveEpubProgress(document.meta.fingerprint, {
        chapterId: chunk.chapterId,
        chapterIndex: chunk.chapterIndex,
        characterOffset: chunk.startOffset,
        optimized: optimizeForSpeech,
      })
    },
    [chunkRecords, document, optimizeForSpeech],
  )

  const markEpubPlaybackComplete = useCallback(() => {
    if (document?.kind !== 'epub' || !document.meta?.fingerprint) return
    clearEpubProgress(document.meta.fingerprint)
    setResumePosition(null)
  }, [document])

  const handleRemoveModel = useCallback(async () => {
    if (runtimeSwitchingRef.current) return
    const ok = window.confirm(
      'Remove the voice model from this device? You can download it again anytime. Your documents are not stored and will not be affected.',
    )
    if (!ok) return

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
    } catch (err) {
      console.error(err)
      setModelError(err?.message || 'Could not remove the cached model.')
    } finally {
      setRemovingModel(false)
    }
  }, [stopPlayback])

  const handleCompatibilityModeChange = useCallback(
    async (enabled) => {
      if (
        enabled === compatibilityMode ||
        runtimeSwitchingRef.current ||
        removingModel ||
        modelStatus === 'downloading' ||
        modelStatus === 'loading' ||
        playing ||
        paused
      ) {
        return
      }

      runtimeSwitchingRef.current = true
      runtimeVersionRef.current += 1
      setSwitchingRuntime(true)
      setCompatibilityMode(enabled)
      writeCompatibilityMode(enabled)
      stopPlayback()
      unloadKokoro()
      runtimeRef.current = null
      setGenStats(null)
      setModelError(null)
      setModelProgress(0)
      setModelStatus('loading')

      try {
        const runtime = await chooseRuntime({ compatibilityMode: enabled })
        runtimeRef.current = runtime
        const cached = await isModelCached(runtime)
        setDisplaySize(runtime.displaySize)
        setDeviceLabel(runtime.note)
        setModelStatus(cached ? 'ready' : 'needed')
      } catch (err) {
        console.error(err)
        setModelStatus('needed')
        setModelError(err?.message || 'Could not switch voice mode.')
      } finally {
        runtimeSwitchingRef.current = false
        setSwitchingRuntime(false)
      }
    },
    [compatibilityMode, modelStatus, paused, playing, removingModel, stopPlayback],
  )

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
      const voice = webSpeechVoices.find((v) => v.voiceURI === webSpeechVoiceURI) || null
      const isCurrentRun = () => playbackRunRef.current === playbackRun

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
          setPlaying(false)
          setPaused(false)
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
          device: meta.device === 'webgpu' ? 'WebGPU' : meta.device === 'wasm' ? 'WASM' : null,
          dtype: meta.dtype || null,
          speed: speedRef.current,
          chunksDone: partial.chunksDone ?? 0,
          chunksTotal: chunks.length,
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

      try {
        await ensureEngine()
        const ctx = ensureAudio()
        if (ctx.state === 'suspended') await ctx.resume()

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
        if (isCurrentRun()) setPlayError(err?.message || 'Playback failed.')
      } finally {
        if (isCurrentRun()) {
          playbackRef.current = null
          setPlaying(false)
          setPaused(false)
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
      voiceId,
    ],
  )

  const runPlayback = useCallback(
    async (startIndex = 0) => {
      setPlayError(null)
      setDownloadNote(null)
      const playbackRun = playbackRunRef.current + 1
      playbackRunRef.current = playbackRun
      stoppedRef.current = false
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

  const startListening = (startIndex) => {
    if (!chunks.length) return
    if (!firstPlayTrackedRef.current) {
      firstPlayTrackedRef.current = true
      track(Events.FIRST_PLAY, { engine })
    }
    listenedChunksRef.current = 0
    runPlayback(startIndex)
  }

  const resumeListening = (position) => {
    if (!position) return false
    setSelectedChapterIndex(position.chapterIndex)
    setResumePosition(null)
    track(Events.EPUB_RESUME, { chapter: position.chapterIndex + 1 })
    startListening(startIndexForResume(position))
    return true
  }

  const onPlay = () => {
    if (isEpub && resumeListening(resumePosition)) return
    startListening(isEpub ? startIndexForChapter(selectedChapterIndex) : 0)
  }

  const onPause = async () => {
    setPaused(true)
    if (engine === 'webspeech') {
      try {
        window.speechSynthesis?.pause()
      } catch {
        /* best-effort only */
      }
      return
    }
    // Suspend the graph clock so the current chunk keeps its place; no gap on resume.
    try {
      await audioCtxRef.current?.suspend()
    } catch {
      /* ignore */
    }
  }

  const onResume = async () => {
    setPaused(false)
    if (engine === 'webspeech') {
      try {
        window.speechSynthesis?.resume()
      } catch {
        /* best-effort only */
      }
      return
    }
    try {
      await audioCtxRef.current?.resume()
    } catch {
      /* ignore */
    }
  }

  const onStop = () => {
    stopPlayback()
    maybeShowNudge()
  }

  const onChapterChange = useCallback((chapterIndex) => {
    if (!isEpub || chapterIndex === selectedChapterIndex) return
    stopPlayback()
    setSelectedChapterIndex(chapterIndex)
    setResumePosition(null)
    setPlayError(null)
  }, [isEpub, selectedChapterIndex, stopPlayback])

  const onResumeBook = () => {
    resumeListening(resumePosition)
  }

  const onStartBookOver = () => {
    if (document?.kind === 'epub') clearEpubProgress(document.meta?.fingerprint)
    stopPlayback()
    setSelectedChapterIndex(0)
    setResumePosition(null)
    setPlayError(null)
  }

  const onEngineChange = (next) => {
    if (next === engine) return
    stopPlayback()
    setGenStats(null)
    setPlayError(null)
    setEngine(next)
    track(Events.ENGINE_SWITCH, { to: next })
  }

  const onKokoroVoiceChange = (id) => {
    setVoiceId(id)
    prefetchVoice(id)
  }

  const onWebSpeechVoiceChange = (uri) => {
    setWebSpeechVoiceURI(uri)
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
      setSelectedChapterIndex(0)
      setResumePosition(null)
    } finally {
      setIngestBusy(false)
    }
  }

  const onPasteSubmit = (e) => {
    e.preventDefault()
    setIngestError(null)
    stopPlayback()
    try {
      const doc = extractFromPaste(paste)
      applyDocument(doc)
      track(Events.DOCUMENT_LOADED, { source: 'paste', kind: doc.kind })
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
  const previewChapterIndex = isEpub ? activeChunkRecord?.chapterIndex ?? selectedChapterIndex : 0
  const previewChapterStartIndex = chapterStartIndexes.get(previewChapterIndex) ?? 0
  const previewChunks = useMemo(() => {
    if (!isEpub) return chunks
    return chunkRecords
      .filter((chunk) => chunk.chapterIndex === previewChapterIndex)
      .map((chunk) => chunk.text)
  }, [chunkRecords, chunks, isEpub, previewChapterIndex])
  const previewActiveChunkIndex = isEpub
    ? activeChunkRecord
      ? activeChunk - previewChapterStartIndex
      : -1
    : activeChunk
  const currentEpubChunk =
    activeChunkRecord || chunkRecords[chapterStartIndexes.get(selectedChapterIndex) ?? 0]
  const currentEpubPercent = isEpub
    ? bookProgressPercent(
        document.chapters,
        currentEpubChunk?.chapterIndex ?? selectedChapterIndex,
        currentEpubChunk?.startOffset ?? 0,
      )
    : 0
  const resumeChapter = isEpub && resumePosition ? document.chapters?.[resumePosition.chapterIndex] : null
  const resumePercent = resumePosition
    ? bookProgressPercent(document?.chapters, resumePosition.chapterIndex, resumePosition.characterOffset)
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

  const engineReady = engine === 'webspeech' ? WEB_SPEECH_SUPPORTED : modelStatus === 'ready'
  const readyHint =
    engine === 'kokoro' && modelStatus !== 'ready'
      ? 'Download the voice model to start listening.'
      : null

  return (
    <div className="jr-app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {!bannerDismissed && capabilityMsg && engine === 'kokoro' ? (
        <CapabilityBanner message={capabilityMsg} onDismiss={() => setBannerDismissed(true)} />
      ) : null}

      <header className="jr-nav">
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
        <p className="jr-nav-privacy">Free / private / on-device</p>
      </header>

      <main id="main" className="jr-main">
        <section className="jr-hero">
          <p className="jr-kicker">Free browser tool</p>
          <h1 className="jr-brand">
            Junco <em>Reader</em>
          </h1>
          <p className="jr-lede">
            Read PDFs, EPUBs, and text out loud in your browser. Free, private, on-device.
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
              activeChunkIndex={previewActiveChunkIndex}
              chapterIndex={previewChapterIndex}
              onChapterChange={onChapterChange}
              bookProgressLabel={chapterNavigationLabel}
            />

            {isEpub && resumePosition && resumeChapter ? (
              <aside className="jr-resume-card" aria-label="Saved audiobook position">
                <div>
                  <p className="jr-resume-kicker">Saved listening position</p>
                  <p className="jr-resume-copy">
                    Resume at chapter {resumePosition.chapterIndex + 1}, {resumeChapter.title}
                    {resumeAtChapterStart
                      ? ' — speech optimization changed, so playback will begin at this chapter’s start.'
                      : ` — about ${resumePercent}% through the book.`}
                  </p>
                </div>
                <div className="jr-resume-actions">
                  <button
                    type="button"
                    className="jr-btn jr-btn-primary"
                    onClick={onResumeBook}
                    disabled={!engineReady}
                  >
                    Resume
                  </button>
                  <button type="button" className="jr-btn jr-btn-ghost" onClick={onStartBookOver}>
                    Start over
                  </button>
                </div>
              </aside>
            ) : null}

            <div className="jr-controls">
              <div className="jr-controls-row">
                <VoicePicker
                  engine={engine}
                  onEngineChange={onEngineChange}
                  webSpeechSupported={WEB_SPEECH_SUPPORTED}
                  kokoroVoiceId={voiceId}
                  onKokoroVoiceChange={onKokoroVoiceChange}
                  webSpeechVoices={webSpeechVoices}
                  webSpeechVoiceURI={webSpeechVoiceURI}
                  onWebSpeechVoiceChange={onWebSpeechVoiceChange}
                  disabled={playing && !paused}
                />
                <SpeedControl value={speed} onChange={onSpeedChange} />
                <Player
                  ready={engineReady}
                  readyHint={readyHint}
                  playing={playing}
                  paused={paused}
                  progressLabel={progressLabel}
                  onPlay={onPlay}
                  onPause={onPause}
                  onResume={onResume}
                  onStop={onStop}
                  disabled={!chunks.length || ingestBusy}
                />
              </div>

              {engine === 'kokoro' ? (
                <ModelDownloadButton
                  status={modelStatus === 'unknown' ? 'needed' : modelStatus}
                  progress={modelProgress}
                  displaySize={displaySize}
                  deviceLabel={deviceLabel}
                  error={modelError}
                  onDownload={handleDownload}
                  onRemove={handleRemoveModel}
                  removing={removingModel}
                  disabled={switchingRuntime || removingModel}
                  compatibilityMode={compatibilityMode}
                  compatibilityDisabled={
                    switchingRuntime ||
                    removingModel ||
                    playing ||
                    paused ||
                    modelStatus === 'downloading' ||
                    modelStatus === 'loading'
                  }
                  onCompatibilityModeChange={handleCompatibilityModeChange}
                />
              ) : null}

              <div className="jr-options" role="group" aria-label="Generation options">
                {engine === 'kokoro' && !isEpub ? (
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
                ) : null}
                <label className={`jr-option ${playing && !paused ? 'is-disabled' : ''}`}>
                  <input
                    type="checkbox"
                    checked={optimizeForSpeech}
                    disabled={playing && !paused}
                    onChange={(e) => onOptimizeForSpeechChange(e.target.checked)}
                  />
                  <span className="jr-option-copy">
                    <span className="jr-option-title">Optimize for speech</span>
                    <span className="jr-option-hint">
                      Clean text so Kokoro reads more naturally
                    </span>
                  </span>
                </label>
              </div>

              {playError ? <p className="jr-error">{playError}</p> : null}
              {downloadNote ? <p className="jr-status">{downloadNote}</p> : null}
              {engine === 'kokoro' && genStats ? <GenerationStats stats={genStats} /> : null}
            </div>
          </section>
        ) : null}

        <section className="jr-footnote">
          <p>
            Kokoro-82M runs entirely in your browser. Only the voice model is downloaded when you
            ask; your documents stay on your device.{' '}
            <a href={MARKETING_URL} target="_blank" rel="noopener noreferrer">
              Junco
            </a>{' '}
            turns newsletters into a daily podcast on iPhone with the same family of voices.
          </p>
        </section>
      </main>

      <AppStoreCta />
      <PostListenNudge
        open={nudgeOpen}
        engine={engine}
        onTryNatural={() => onEngineChange('kokoro')}
        onClose={() => setNudgeOpen(false)}
      />
    </div>
  )
}
