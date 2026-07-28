import './CapabilityBanner.css'

export default function CapabilityBanner({ message, onDismiss }) {
  if (!message) return null

  return (
    <div className="jr-banner" role="status">
      <p className="jr-banner-text">{message}</p>
      {onDismiss ? (
        <button type="button" className="jr-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      ) : null}
    </div>
  )
}
