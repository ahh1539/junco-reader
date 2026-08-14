import './PlaybackTargetNotice.css'

export default function PlaybackTargetNotice({
  target,
  playing = false,
  paused = false,
  ready = false,
  onPlayFromHere,
  className = '',
}) {
  if (!target) return null

  return (
    <div className={`jr-playback-target${className ? ` ${className}` : ''}`} role="status">
      <span>
        {playing || paused ? 'Viewing' : 'Ready at'}: {target.label}
      </span>
      {ready && onPlayFromHere ? (
        <button type="button" onClick={onPlayFromHere}>
          Play from here
        </button>
      ) : null}
    </div>
  )
}
