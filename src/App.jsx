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
import { chunkText } from './lib/chunkText'
import { downloadWav, MAX_DOWNLOAD_AUDIO_SECONDS } from './lib/encodeWav'
import { extractFromFile, extractFromPaste } from './lib/extractText'
import { formatForTts } from './lib/formatForTts'
import {
  DEFAULT_DISPLAY_SIZE,
  clearModelCache,
  isModelCached,
  loadManifest,
} from './lib/modelCache'
import { chooseRuntime } from './lib/kokoroEngine'
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

  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [activeChunk, setActiveChunk] = useState(-1)
  const [playError, setPlayError] = useState(null)
  const [downloadNote, setDownloadNote] = useState(null)

  const [capabilityMsg, setCapabilityMsg] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [genStats, setGenStats] = useState(null)

  const audioCtxRef = useRef(null)
  const playbackRef = useRef(null) // { setSpeed, stop, done } from either engine
  const stoppedRef = useRef(false)
  const speedRef = useRef(1)
  const downloadAudioRef = useRef(false)
  const runtimeRef = useRef(null) // cached chooseRuntime() result
  const listenedChunksRef = useRef(0)
  const statsThrottleRef = useRef(0)
  const firstPlayTrackedRef = useRef(false)

  const speakText = useMemo(() => {
    if (!document?.text) return ''
    return optimizeForSpeech ? formatForTts(document.text) : document.text
  }, [document, optimizeForSpeech])

  const chunks = useMemo(() => (speakText ? chunkText(speakText) : []), [speakText])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [manifest, cap, runtime, webSpeechVoiceList] = await Promise.all([
        loadManifest(),
        getCapabilityMessage(),
        chooseRuntime(),
        getWebSpeechVoices(),
      ])
      if (cancelled) return
      runtimeRef.current = runtime
      const cached = await isModelCached(runtime)
      setDisplaySize(runtime.displaySize || manifest?.displaySize || DEFAULT_DISPLAY_SIZE)
      setDeviceLabel(runtime.note)
      setModelStatus(cached ? 'ready' : 'needed')
      setCapabilityMsg(cap)
      setWebSpeechVoices(webSpeechVoiceList)
      const preferred = preferredDefaultVoice(webSpeechVoiceList)
      if (preferred) setWebSpeechVoiceURI(preferred.voiceURI)
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

  const handleDownload = useCallback(async () => {
    track(Events.MODEL_DOWNLOAD_START)
    setModelError(null)
    setModelStatus('downloading')
    setModelProgress(0)
    try {
      const runtime = await ensureRuntime()
      const meta = await loadKokoro({
        device: runtime.device,
        dtype: runtime.dtype,
        onProgress: (info) => {
          if (info?.status === 'progress' && typeof info.progress === 'number') {
            const raw = info.progress
            setModelProgress(raw <= 1 ? raw * 100 : raw)
            setModelStatus('downloading')
          } else if (info?.status === 'done' || info?.status === 'ready') {
            setModelProgress(100)
          } else if (info?.status === 'initiate') {
            setModelStatus('downloading')
          }
        },
      })
      await warmUp(voiceId)
      setDeviceLabel(meta.device === 'webgpu' ? 'WebGPU' : 'WASM')
      setModelProgress(100)
      setModelStatus('ready')
      track(Events.MODEL_DOWNLOAD_COMPLETE, { device: meta.device, dtype: runtime.dtype })
    } catch (err) {
      console.error(err)
      setModelStatus('needed')
      setModelError(err?.message || 'Download failed. Check your connection and try again.')
    }
  }, [ensureRuntime, voiceId])

  const ensureEngine = useCallback(async () => {
    const alreadyLoaded = Boolean(getLoadedMeta().device)
    if (!alreadyLoaded) setModelStatus((s) => (s === 'ready' ? 'loading' : 'downloading'))
    const runtime = await ensureRuntime()
    const meta = await loadKokoro({
      device: runtime.device,
      dtype: runtime.dtype,
      onProgress: (info) => {
        if (info?.status === 'progress' && typeof info.progress === 'number') {
          const raw = info.progress
          setModelProgress(raw <= 1 ? raw * 100 : raw)
        }
      },
    })
    await warmUp(voiceId)
    setDeviceLabel(meta.device === 'webgpu' ? 'WebGPU' : 'WASM')
    setModelStatus('ready')
    return meta
  }, [ensureRuntime, voiceId])

  const stopPlayback = useCallback(() => {
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

  const handleRemoveModel = useCallback(async () => {
    const ok = window.confirm(
      'Remove the voice model from this device? You can download it again anytime. Your documents are not stored and will not be affected.',
    )
    if (!ok) return

    setRemovingModel(true)
    setModelError(null)
    try {
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

  const maybeShowNudge = useCallback(() => {
    if (hasSeenNudge()) return
    if (listenedChunksRef.current >= 1) {
      markNudgeSeen()
      setNudgeOpen(true)
    }
  }, [])

  const runWebSpeech = useCallback(
    async (startIndex) => {
      const playChunks = chunks.slice(startIndex)
      const voice = webSpeechVoices.find((v) => v.voiceURI === webSpeechVoiceURI) || null

      try {
        const playback = runWebSpeechPlayback({
          chunks: playChunks,
          voice,
          initialRate: speedRef.current,
          handlers: {
            onChunkStart: (i) => setActiveChunk(startIndex + i),
            onProgress: (info) => {
              listenedChunksRef.current = info.chunksDone
            },
          },
        })
        playbackRef.current = playback
        await playback.done
        if (!stoppedRef.current) {
          setActiveChunk(-1)
          maybeShowNudge()
        }
      } catch (err) {
        console.error(err)
        setPlayError(err?.message || 'Playback failed.')
      } finally {
        playbackRef.current = null
        setPlaying(false)
        setPaused(false)
      }
    },
    [chunks, maybeShowNudge, webSpeechVoiceURI, webSpeechVoices],
  )

  const runKokoro = useCallback(
    async (startIndex) => {
      const voice = voiceById(voiceId)
      const playChunks = chunks.slice(startIndex)
      const shouldCollectAudio = downloadAudioRef.current

      const pushStats = (live, partial = {}) => {
        if (live) {
          const now = performance.now()
          if (now - statsThrottleRef.current < 150) return
          statsThrottleRef.current = now
        }
        const meta = getLoadedMeta()
        setGenStats({
          live,
          voice: voice.displayName,
          device: meta.device === 'webgpu' ? 'WebGPU' : meta.device === 'wasm' ? 'WASM' : deviceLabel,
          dtype: meta.dtype || 'q8',
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
            onChunkStart: (i) => setActiveChunk(startIndex + i),
            onProgress: (info) => {
              listenedChunksRef.current = info.chunksDone
              pushStats(true, info)
            },
            onAudioCap: (info) => {
              if (!downloadAudioRef.current || !info.audioChunks?.length) return
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
          downloadAudioRef.current &&
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

        if (!stoppedRef.current) {
          setActiveChunk(-1)
          maybeShowNudge()
        }
      } catch (err) {
        console.error(err)
        setPlayError(err?.message || 'Playback failed.')
      } finally {
        playbackRef.current = null
        setPlaying(false)
        setPaused(false)
      }
    },
    [chunks, deviceLabel, document?.name, ensureEngine, maybeShowNudge, voiceId],
  )

  const runPlayback = useCallback(
    async (startIndex = 0) => {
      setPlayError(null)
      setDownloadNote(null)
      stoppedRef.current = false
      setPlaying(true)
      setPaused(false)

      if (engine === 'webspeech') {
        await runWebSpeech(startIndex)
      } else {
        await runKokoro(startIndex)
      }
    },
    [engine, runKokoro, runWebSpeech],
  )

  const onPlay = () => {
    if (!chunks.length) return
    if (!firstPlayTrackedRef.current) {
      firstPlayTrackedRef.current = true
      track(Events.FIRST_PLAY, { engine })
    }
    listenedChunksRef.current = 0
    runPlayback(0)
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
      setDocument(doc)
      setGenStats(null)
      track(Events.DOCUMENT_LOADED, { source: 'file', kind: doc.kind })
    } catch (err) {
      setIngestError(err?.message || 'Could not read that file.')
      setDocument(null)
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
      setDocument(doc)
      setGenStats(null)
      track(Events.DOCUMENT_LOADED, { source: 'paste', kind: doc.kind })
    } catch (err) {
      setIngestError(err?.message || 'Nothing to read.')
    }
  }

  const onTrySample = () => {
    setIngestError(null)
    stopPlayback()
    const doc = sampleDocument()
    setDocument(doc)
    setGenStats(null)
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
              setDocument(doc)
              setGenStats(null)
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

  const progressLabel =
    playing || paused
      ? `Chunk ${Math.max(activeChunk, 0) + 1} of ${chunks.length}${paused ? ' / paused' : ''}`
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
            Read any PDF out loud in your browser. Free, private, on-device.
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
              chunks={chunks}
              activeChunkIndex={activeChunk}
            />

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
                />
              ) : null}

              <div className="jr-options" role="group" aria-label="Generation options">
                {engine === 'kokoro' ? (
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
