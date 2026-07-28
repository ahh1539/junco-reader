import './Player.css'

export default function Player({
  modelReady,
  playing,
  paused,
  progressLabel,
  onPlay,
  onPause,
  onResume,
  onStop,
  disabled,
}) {
  return (
    <div className="jr-player">
      {!modelReady ? (
        <p className="jr-player-hint">Download the voice model to start listening.</p>
      ) : null}

      <div className="jr-player-controls">
        {!playing ? (
          <button
            type="button"
            className="jr-btn jr-btn-primary"
            onClick={onPlay}
            disabled={disabled || !modelReady}
          >
            Listen
          </button>
        ) : paused ? (
          <button type="button" className="jr-btn jr-btn-primary" onClick={onResume}>
            Resume
          </button>
        ) : (
          <button type="button" className="jr-btn jr-btn-primary" onClick={onPause}>
            Pause
          </button>
        )}

        <button
          type="button"
          className="jr-btn jr-btn-ghost"
          onClick={onStop}
          disabled={!playing && !paused}
        >
          Stop
        </button>
      </div>

      {progressLabel ? <p className="jr-player-progress">{progressLabel}</p> : null}
    </div>
  )
}
