import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import AppStoreCta from './components/AppStoreCta'
import CapabilityBanner from './components/CapabilityBanner'
import DocumentPreview from './components/DocumentPreview'
import DropZone from './components/DropZone'
import GenerationStats from './components/GenerationStats'
import ModelDownloadButton from './components/ModelDownloadButton'
import Player from './components/Player'
import PostListenNudge, { hasSeenNudge, markNudgeSeen } from './components/PostListenNudge'
import VoicePicker from './components/VoicePicker'

import { getCapabilityMessage } from './lib/capability'
import { chunkText } from './lib/chunkText'
import { extractFromFile, extractFromPaste } from './lib/extractText'
import {
  DEFAULT_DISPLAY_SIZE,
  isModelCached,
  loadManifest,
} from './lib/modelCache'
import {
  getLoadedMeta,
  loadKokoro,
  playRawAudio,
  synthesizeChunk,
} from './lib/kokoroEngine'
import { DEFAULT_VOICE_ID, voiceById } from './lib/voices'
import { MARKETING_URL } from './lib/appStore'

import './App.css'

export default function App() {
  const [document, setDocument] = useState(null)
  const [paste, setPaste] = useState('')
  const [ingestError, setIngestError] = useState(null)
  const [ingestBusy, setIngestBusy] = useState(false)

  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)
  const [modelStatus, setModelStatus] = useState('unknown') // unknown | needed | downloading | loading | ready
  const [modelProgress, setModelProgress] = useState(0)
  const [modelError, setModelError] = useState(null)
  const [displaySize, setDisplaySize] = useState(DEFAULT_DISPLAY_SIZE)
  const [deviceLabel, setDeviceLabel] = useState(null)

  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [activeChunk, setActiveChunk] = useState(-1)
  const [playError, setPlayError] = useState(null)

  const [capabilityMsg, setCapabilityMsg] = useState(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [nudgeOpen, setNudgeOpen] = useState(false)
  const [genStats, setGenStats] = useState(null)

  const ttsRef = useRef(null)
  const audioCtxRef = useRef(null)
  const stopRef = useRef(null)
  const abortRef = useRef(false)
  const pauseGateRef = useRef(null)
  const listenedChunksRef = useRef(0)

  const chunks = useMemo(
    () => (document?.text ? chunkText(document.text) : []),
    [document],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [cached, manifest, cap] = await Promise.all([
        isModelCached(),
        loadManifest(),
        getCapabilityMessage(),
      ])
      if (cancelled) return
      if (manifest?.displaySize) setDisplaySize(manifest.displaySize)
      setModelStatus(cached ? 'ready' : 'needed')
      setCapabilityMsg(cap)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const ensureAudio = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  const handleDownload = useCallback(async () => {
    setModelError(null)
    setModelStatus('downloading')
    setModelProgress(0)
    try {
      const tts = await loadKokoro({
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
      ttsRef.current = tts
      const meta = getLoadedMeta()
      setDeviceLabel(meta.device === 'webgpu' ? 'WebGPU' : 'WASM')
      setModelProgress(100)
      setModelStatus('ready')
    } catch (err) {
      console.error(err)
      setModelStatus('needed')
      setModelError(err?.message || 'Download failed. Check your connection and try again.')
    }
  }, [])

  const ensureEngine = useCallback(async () => {
    if (ttsRef.current) return ttsRef.current
    setModelStatus((s) => (s === 'ready' ? 'loading' : 'downloading'))
    const tts = await loadKokoro({
      onProgress: (info) => {
        if (info?.status === 'progress' && typeof info.progress === 'number') {
          const raw = info.progress
          setModelProgress(raw <= 1 ? raw * 100 : raw)
        }
      },
    })
    ttsRef.current = tts
    const meta = getLoadedMeta()
    setDeviceLabel(meta.device === 'webgpu' ? 'WebGPU' : 'WASM')
    setModelStatus('ready')
    return tts
  }, [])

  const stopPlayback = useCallback(() => {
    abortRef.current = true
    stopRef.current?.stop()
    stopRef.current = null
    pauseGateRef.current = null
    setPlaying(false)
    setPaused(false)
    setActiveChunk(-1)
  }, [])

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
      abortRef.current = false
      setPlaying(true)
      setPaused(false)

      const meta = getLoadedMeta()
      const voice = voiceById(voiceId)
      const sessionStart = performance.now()
      let firstAudioAt = null
      let synthMs = 0
      let audioSec = 0
      let charsSpoken = 0
      let chunksDone = 0

      const pushStats = (live) => {
        const wallMs = performance.now() - sessionStart
        setGenStats({
          live,
          voice: voice.displayName,
          device: meta.device === 'webgpu' ? 'WebGPU' : meta.device === 'wasm' ? 'WASM' : deviceLabel,
          dtype: meta.dtype || 'q8',
          chunksDone,
          chunksTotal: chunks.length,
          charsSpoken,
          ttfaMs: firstAudioAt != null ? firstAudioAt - sessionStart : null,
          synthMs,
          audioSec,
          rtf: audioSec > 0 && synthMs > 0 ? synthMs / 1000 / audioSec : null,
          wallMs,
        })
      }

      pushStats(true)

      try {
        const tts = await ensureEngine()
        const ctx = ensureAudio()
        if (ctx.state === 'suspended') await ctx.resume()

        for (let i = startIndex; i < chunks.length; i++) {
          if (abortRef.current) break

          while (pauseGateRef.current) {
            await pauseGateRef.current
            if (abortRef.current) break
          }
          if (abortRef.current) break

          setActiveChunk(i)
          const synthStart = performance.now()
          const raw = await synthesizeChunk(tts, chunks[i], { voice: voiceId })
          synthMs += performance.now() - synthStart
          if (abortRef.current) break

          while (pauseGateRef.current) {
            await pauseGateRef.current
            if (abortRef.current) break
          }
          if (abortRef.current) break

          if (firstAudioAt == null) firstAudioAt = performance.now()

          const handle = await playRawAudio(raw, ctx)
          stopRef.current = handle
          audioSec += handle.duration || 0
          charsSpoken += chunks[i].length
          chunksDone += 1
          pushStats(true)

          await handle.done
          stopRef.current = null
          listenedChunksRef.current += 1
        }

        pushStats(false)

        if (!abortRef.current) {
          setActiveChunk(-1)
          maybeShowNudge()
        }
      } catch (err) {
        console.error(err)
        setPlayError(err?.message || 'Playback failed.')
        pushStats(false)
      } finally {
        setPlaying(false)
        setPaused(false)
      }
    },
    [chunks, deviceLabel, ensureEngine, maybeShowNudge, voiceId],
  )

  const onPlay = () => {
    if (!chunks.length) return
    listenedChunksRef.current = 0
    runPlayback(0)
  }

  const onPause = () => {
    setPaused(true)
    stopRef.current?.stop()
    stopRef.current = null
    let release
    pauseGateRef.current = new Promise((r) => {
      release = r
    })
    pauseGateRef.current.release = release
  }

  const onResume = async () => {
    const gate = pauseGateRef.current
    pauseGateRef.current = null
    gate?.release?.()
    setPaused(false)
    const ctx = ensureAudio()
    if (ctx.state === 'suspended') await ctx.resume()
    // If we stopped mid-chunk, restart from current chunk
    if (!playing && activeChunk >= 0) {
      runPlayback(activeChunk)
    }
  }

  const onStop = () => {
    stopPlayback()
    maybeShowNudge()
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
      ? `Chunk ${Math.max(activeChunk, 0) + 1} of ${chunks.length}${paused ? ' · paused' : ''}`
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
        <p className="jr-nav-privacy">Free · private · on-device</p>
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
              placeholder="Paste an article, notes, or Markdown…"
            />
            <button type="submit" className="jr-btn jr-btn-ghost" disabled={!paste.trim()}>
              Use pasted text
            </button>
          </form>

          {ingestBusy ? <p className="jr-status">Extracting text…</p> : null}
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
              />

              <div className="jr-controls-row">
                <VoicePicker
                  value={voiceId}
                  onChange={setVoiceId}
                  disabled={playing && !paused}
                />
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
