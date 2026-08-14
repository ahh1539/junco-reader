import './Player.css'

export default function Player({
  ready,
  readyHint,
  playing,
  paused,
  canPause = true,
  progressLabel,
  onPlay,
  onPause,
  onResume,
  onStop,
  disabled,
}) {
  return (
    <div className="jr-player">
      {!ready && readyHint ? <p className="jr-player-hint">{readyHint}</p> : null}

      <div className="jr-player-controls">
        {!playing ? (
          <button
            type="button"
            className="jr-btn jr-btn-primary"
            onClick={onPlay}
            disabled={disabled || !ready}
          >
            Listen
          </button>
        ) : paused ? (
          <button type="button" className="jr-btn jr-btn-primary" onClick={onResume}>
            Resume
          </button>
        ) : (
          <button
            type="button"
            className="jr-btn jr-btn-primary"
            onClick={onPause}
            disabled={!canPause}
          >
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
