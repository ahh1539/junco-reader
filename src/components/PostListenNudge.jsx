import { APP_STORE_URL } from '../lib/appStore'
import './PostListenNudge.css'

const NUDGE_KEY = 'jr_nudge_seen_v1'

export function hasSeenNudge() {
  try {
    return localStorage.getItem(NUDGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markNudgeSeen() {
  try {
    localStorage.setItem(NUDGE_KEY, '1')
  } catch {
    /* ignore */
  }
}

export default function PostListenNudge({ open, onClose }) {
  if (!open) return null

  return (
    <div className="jr-nudge-backdrop" role="presentation" onClick={onClose}>
      <div
        className="jr-nudge"
        role="dialog"
        aria-labelledby="jr-nudge-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="jr-nudge-kicker">One more thing</p>
        <h2 id="jr-nudge-title" className="jr-nudge-title">
          Liked the voice?
        </h2>
        <p className="jr-nudge-body">
          Junco uses the same on-device Kokoro voices to turn your newsletters into a short daily
          podcast, free on iPhone.
        </p>
        <div className="jr-nudge-actions">
          <a
            className="jr-btn jr-btn-primary"
            href={APP_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
          >
            Download Junco
          </a>
          <button type="button" className="jr-btn jr-btn-ghost" onClick={onClose}>
            Keep reading
          </button>
        </div>
      </div>
    </div>
  )
}
