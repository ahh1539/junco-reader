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
  disabled = false,
  compact = false,
  unavailableReason = null,
  unavailableTitle = 'Natural voice unavailable',
  onUseBuiltIn,
}) {
  const pct = Math.round(Math.min(100, Math.max(0, progress || 0)))
  const shellClass = `jr-model${compact ? ' is-compact' : ''}`

  if (unavailableReason) {
    return (
      <div className={shellClass}>
        <p className="jr-model-title">{unavailableTitle}</p>
        <p className="jr-model-sub">{unavailableReason}</p>
        {onUseBuiltIn ? (
          <button type="button" className="jr-btn jr-btn-ghost jr-model-btn" onClick={onUseBuiltIn}>
            Use built-in speech
          </button>
        ) : null}
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <div className={`${shellClass} is-ready`}>
        <span className="jr-model-dot" aria-hidden="true" />
        <div className="jr-model-ready-copy">
          <p className="jr-model-title">Voice model ready</p>
          <p className="jr-model-sub">
            Cached on this device{deviceLabel ? ` / ${deviceLabel}` : ''}. Revisits won&apos;t re-download.
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
      <div className={`${shellClass} is-busy`} role="status" aria-live="polite">
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
    <div className={shellClass}>
      <button
        type="button"
        className="jr-btn jr-btn-primary jr-model-btn"
        onClick={onDownload}
        disabled={disabled}
      >
        Download Natural voice
      </button>
      {compact ? null : (
        <p className="jr-model-sub">
          Full-quality {displaySize} one-time download. WebGPU required. Fetched directly to this
          browser from Hugging Face, then synthesized client-side. Junco does not upload or
          persist document contents.
        </p>
      )}
      {error ? (
        <p className="jr-model-error">
          {error}
          {onUseBuiltIn ? (
            <>
              {' '}
              <button type="button" className="jr-model-fallback" onClick={onUseBuiltIn}>
                Use built-in speech
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  )
}
