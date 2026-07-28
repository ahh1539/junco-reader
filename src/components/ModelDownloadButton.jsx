import './ModelDownloadButton.css'

export default function ModelDownloadButton({
  status,
  progress,
  displaySize,
  deviceLabel,
  error,
  onDownload,
  onRemove,
  removing = false,
}) {
  const pct = Math.round(Math.min(100, Math.max(0, progress || 0)))

  if (status === 'ready') {
    return (
      <div className="jr-model is-ready">
        <span className="jr-model-dot" aria-hidden="true" />
        <div className="jr-model-ready-copy">
          <p className="jr-model-title">Voice model ready</p>
          <p className="jr-model-sub">
            Cached on this device{deviceLabel ? ` / ${deviceLabel}` : ''}. Revisits won't re-download.
          </p>
          {onRemove ? (
            <button
              type="button"
              className="jr-model-remove"
              onClick={onRemove}
              disabled={removing}
            >
              {removing ? 'Removing...' : 'Remove from this device'}
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  if (status === 'downloading' || status === 'loading') {
    return (
      <div className="jr-model is-busy" role="status" aria-live="polite">
        <p className="jr-model-title">
          {status === 'downloading' ? 'Downloading voice model...' : 'Loading voice model...'}
        </p>
        <div className="jr-model-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="jr-model-sub">{pct}% / stays on this device / free</p>
      </div>
    )
  }

  return (
    <div className="jr-model">
      <button type="button" className="jr-btn jr-btn-primary jr-model-btn" onClick={onDownload}>
        Download voice model
      </button>
      <p className="jr-model-sub">
        {displaySize} / one-time / stays on this device. Documents never leave your browser.
      </p>
      {error ? <p className="jr-model-error">{error}</p> : null}
    </div>
  )
}
