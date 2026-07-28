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
import { extractFromFile, extractFromPaste } from './lib/extractText'
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
import { DEFAULT_VOICE_ID, voiceById } from './lib/voices'
import { MARKETING_URL } from './lib/appStore'
import { Events, track } from './lib/analytics'

import './App.css'

export default function App() {
  const [document, setDocument] = useState(null)
  const [paste, setPaste] = useState('')
  const [ingestError, setIngestError] = useState(null)
  const [ingestBusy, setIngestBusy] = useState(false)

  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [speed, setSpeedState] = useState(1)
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

  const [capabilityMsg, setCapabilityMsg] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [genStats, setGenStats] = useState(null)

  const audioCtxRef = useRef(null)
  const playbackRef = useRef(null) // { setSpeed, stop, done } from runPipelinedPlayback
  const stoppedRef = useRef(false)
  const speedRef = useRef(1)
  const runtimeRef = useRef(null) // cached chooseRuntime() result
  const listenedChunksRef = useRef(0)
  const statsThrottleRef = useRef(0)
  const firstPlayTrackedRef = useRef(false)

  const chunks = useMemo(
    () => (document?.text ? chunkText(document.text) : []),
    [document],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [manifest, cap, runtime] = await Promise.all([
        loadManifest(),
        getCapabilityMessage(),
        chooseRuntime(),
      ])
      if (cancelled) return
      runtimeRef.current = runtime
      const cached = await isModelCached(runtime)
      setDisplaySize(runtime.displaySize || manifest?.displaySize || DEFAULT_DISPLAY_SIZE)
      setDeviceLabel(runtime.note)
      setModelStatus(cached ? 'ready' : 'needed')
      setCapabilityMsg(cap)
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

  const runPlayback = useCallback(
    async (startIndex = 0) => {
      setPlayError(null)
      stoppedRef.current = false
      setPlaying(true)
      setPaused(false)

      const voice = voiceById(voiceId)
      const playChunks = chunks.slice(startIndex)

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
          handlers: {
            onChunkStart: (i) => setActiveChunk(startIndex + i),
            onProgress: (info) => {
              listenedChunksRef.current = info.chunksDone
              pushStats(true, info)
            },
          },
        })
        playbackRef.current = playback

        const result = await playback.done
        pushStats(false, result)

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
    [chunks, deviceLabel, ensureEngine, maybeShowNudge, voiceId],
  )

  const onPlay = () => {
    if (!chunks.length) return
    if (!firstPlayTrackedRef.current) {
      firstPlayTrackedRef.current = true
      track(Events.FIRST_PLAY)
    }
    listenedChunksRef.current = 0
    runPlayback(0)
  }

  const onPause = async () => {
    setPaused(true)
    // Suspend the graph clock so the current chunk keeps its place; no gap on resume.
    try {
      await audioCtxRef.current?.suspend()
    } catch {
      /* ignore */
    }
  }

  const onResume = async () => {
    setPaused(false)
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

  const onVoiceChange = (id) => {
    setVoiceId(id)
    prefetchVoice(id)
  }

  const onSpeedChange = (rate) => {
    setSpeedState(rate)
    speedRef.current = rate
    playbackRef.current?.setSpeed(rate)
  }

  const onFile = async (file) => {
    setIngestError(null)
    setIngestBusy(true)
    stopPlayback()
    try {
      const doc = await extractFromFile(file)
      setDocument(doc)
      setGenStats(null)
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
    } catch (err) {
      setIngestError(err?.message || 'Nothing to read.')
    }
  }

  const progressLabel =
    playing || paused
      ? `Chunk ${Math.max(activeChunk, 0) + 1} of ${chunks.length}${paused ? ' / paused' : ''}`
      : null

  return (
    <div className="jr-app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      {!bannerDismissed && capabilityMsg ? (
        <CapabilityBanner message={capabilityMsg} onDismiss={() => setBannerDismissed(true)} />
      ) : null}

      <header className="jr-nav">
        <a className="jr-nav-brand" href={MARKETING_URL} target="_blank" rel="noopener noreferrer">
          <img
            className="jr-nav-logo pixel-art"
            src="/junco-app-logo.webp"
            alt=""
            width="28"
            height="28"
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

              <div className="jr-controls-row">
                <VoicePicker
                  value={voiceId}
                  onChange={onVoiceChange}
                  disabled={playing && !paused}
                />
                <SpeedControl value={speed} onChange={onSpeedChange} />
                <Player
                  modelReady={modelStatus === 'ready'}
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
              {playError ? <p className="jr-error">{playError}</p> : null}
              {genStats ? <GenerationStats stats={genStats} /> : null}
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
      <PostListenNudge open={nudgeOpen} onClose={() => setNudgeOpen(false)} />
    </div>
  )
}
