import { useState } from 'react'
import ModelDownloadButton from './ModelDownloadButton'
import PlaybackTargetNotice from './PlaybackTargetNotice'
import SpeedControl from './SpeedControl'
import VoicePicker from './VoicePicker'
import './ListenDock.css'

function ChevronIcon({ double, dir = 'left' }) {
  const flip = dir === 'right' ? ' jr-icon-flip' : ''
  return (
    <svg
      className={`jr-icon${flip}`}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      {double ? (
        <>
          <path d="M12 4.5 6.5 10l5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M17 4.5 11.5 10l5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  )
}

function BracketChevronIcon({ dir = 'left' }) {
  const flip = dir === 'right' ? ' jr-icon-flip' : ''
  return (
    <svg
      className={`jr-icon${flip}`}
      viewBox="0 0 20 20"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
    >
      <path d="M6 3.5v13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13.5 4.5 8.5 10l5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M7 4.7c0-1.1 1.2-1.8 2.1-1.2l11 6.8c.9.6.9 1.9 0 2.4l-11 6.8c-.9.6-2.1-.1-2.1-1.2V4.7Z" />
    </svg>
  )
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <rect x="6" y="4" width="4.5" height="16" rx="1.2" />
      <rect x="13.5" y="4" width="4.5" height="16" rx="1.2" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1.5" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg className="jr-listen-voice-chevron" viewBox="0 0 12 8" width="10" height="7" aria-hidden="true">
      <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function ListenDock({
  ready,
  readyHint,
  playing,
  paused,
  disabled,
  progressLabel,
  genStats,
  bookPercent = 0,
  chapterPercent = 0,
  chapterTitle,
  browsingTarget,
  onPlayFromBrowsingTarget,
  onPlay,
  onPause,
  onResume,
  onStop,
  onPrevChapter,
  onNextChapter,
  onPrevSection,
  onNextSection,
  canPrevChapter,
  canNextChapter,
  canPrevSection,
  canNextSection,
  voiceProps,
  speed,
  onSpeedChange,
  onListenInstantly,
  canPause = true,
  modelDownloadProps,
}) {
  const [voiceOpen, setVoiceOpen] = useState(false)
  const modelStatus = modelDownloadProps?.status
  const needsModel = Boolean(modelDownloadProps) && modelStatus !== 'ready'
  const modelBusy = modelStatus === 'downloading' || modelStatus === 'loading'
  const canListenInstantly = Boolean(onListenInstantly && voiceProps?.instantUsable)
  const setupHint = needsModel
    ? modelBusy
      ? canListenInstantly
        ? 'Downloading the Natural voice. You can keep reading, or listen instantly.'
        : 'Downloading the Natural voice. You can keep reading.'
      : `Download the Natural voice (${modelDownloadProps.displaySize || '~326 MB'}) — full-quality, one-time, WebGPU, fetched to this browser.`
    : null
  const liveStats =
    playing && genStats
      ? [
          genStats.device,
          genStats.rtf != null && !Number.isNaN(genStats.rtf) ? `${genStats.rtf.toFixed(2)}× RTF` : null,
          genStats.underruns != null ? `${genStats.underruns} underrun${genStats.underruns === 1 ? '' : 's'}` : null,
        ].filter(Boolean)
      : []

  return (
    <section className={`jr-listen-dock${needsModel ? ' needs-model' : ''}`} aria-label="Listening controls">
      <div className="jr-listen-progress" aria-hidden="true">
        <div className="jr-listen-track is-book">
          <span style={{ width: `${bookPercent}%` }} />
        </div>
        <div className="jr-listen-track is-chapter">
          <span style={{ width: `${chapterPercent}%` }} />
        </div>
      </div>

      <div className="jr-listen-main">
        <div className="jr-listen-meta">
          {chapterTitle ? <p className="jr-listen-chapter">{chapterTitle}</p> : null}
          <PlaybackTargetNotice
            target={browsingTarget}
            playing={playing}
            paused={paused}
            ready={ready}
            onPlayFromHere={onPlayFromBrowsingTarget}
          />
          {setupHint ? (
            <p className="jr-listen-hint">{setupHint}</p>
          ) : progressLabel ? (
            <p className="jr-listen-progress-label">{progressLabel}</p>
          ) : !ready && readyHint ? (
            <p className="jr-listen-hint">{readyHint}</p>
          ) : null}
          {liveStats.length ? (
            <p className="jr-listen-gen-stats">{liveStats.join(' · ')}</p>
          ) : null}
        </div>

        <div className="jr-listen-transport">
          {needsModel ? (
            <div className="jr-listen-get-started">
              <ModelDownloadButton {...modelDownloadProps} compact />
            </div>
          ) : (
            <>
              <button
                type="button"
                className="jr-listen-icon"
                aria-label="Previous chapter"
                onClick={onPrevChapter}
                disabled={!canPrevChapter}
              >
                <ChevronIcon double dir="left" />
              </button>
              <button
                type="button"
                className="jr-listen-icon"
                aria-label="Previous section"
                onClick={onPrevSection}
                disabled={!canPrevSection}
              >
                <BracketChevronIcon dir="left" />
              </button>

              {!playing ? (
                <button
                  type="button"
                  className="jr-listen-play"
                  aria-label="Listen"
                  onClick={onPlay}
                  disabled={disabled || !ready}
                >
                  <PlayIcon />
                </button>
              ) : paused ? (
                <button type="button" className="jr-listen-play" aria-label="Resume" onClick={onResume}>
                  <PlayIcon />
                </button>
              ) : (
                <button
                  type="button"
                  className="jr-listen-play is-playing"
                  aria-label="Pause"
                  onClick={onPause}
                  disabled={!canPause}
                >
                  <PauseIcon />
                </button>
              )}

              <button
                type="button"
                className="jr-listen-icon"
                aria-label="Next section"
                onClick={onNextSection}
                disabled={!canNextSection}
              >
                <BracketChevronIcon dir="right" />
              </button>
              <button
                type="button"
                className="jr-listen-icon"
                aria-label="Next chapter"
                onClick={onNextChapter}
                disabled={!canNextChapter}
              >
                <ChevronIcon double dir="right" />
              </button>

              <span className="jr-listen-stop-wrap">
                <button
                  type="button"
                  className="jr-listen-icon"
                  aria-label="Stop"
                  onClick={onStop}
                  disabled={!playing && !paused}
                >
                  <StopIcon />
                </button>
              </span>
            </>
          )}
        </div>

        <div className="jr-listen-aside">
          {needsModel && canListenInstantly ? (
            <button
              type="button"
              className="jr-listen-instant"
              onClick={onListenInstantly}
            >
              Listen instantly
              <span>No download — browser voice</span>
            </button>
          ) : null}
          <button
            type="button"
            className={`jr-listen-voice-toggle${voiceOpen ? ' is-open' : ''}`}
            aria-expanded={voiceOpen}
            aria-controls="jr-listen-voice-panel"
            onClick={() => setVoiceOpen((open) => !open)}
          >
            Voice & speed
            <ChevronDownIcon />
          </button>
        </div>
      </div>

      <div
        id="jr-listen-voice-panel"
        className={`jr-listen-voice-panel${voiceOpen ? ' is-open' : ''}`}
        aria-hidden={!voiceOpen}
        inert={!voiceOpen ? true : undefined}
      >
        <div className="jr-listen-voice-panel-inner">
          <div className="jr-listen-voice-row">
            <VoicePicker {...voiceProps} />
            <SpeedControl value={speed} onChange={onSpeedChange} />
          </div>
          {modelDownloadProps && !needsModel ? <ModelDownloadButton {...modelDownloadProps} /> : null}
        </div>
      </div>
    </section>
  )
}
