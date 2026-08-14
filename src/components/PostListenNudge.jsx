import { useEffect } from 'react'
import { APP_STORE_URL } from '../lib/appStore'
import { Events, track } from '../lib/analytics'
import './PostListenNudge.css'

export default function PostListenNudge({
  open,
  engine,
  naturalAvailable = true,
  onTryNatural,
  onClose,
}) {
  useEffect(() => {
    if (open) track(Events.NUDGE_SHOWN, { engine })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  // When the first listen uses Instant, point at the free Kokoro upgrade before
  // pitching the iOS app. Once someone's already heard Kokoro, the app pitch
  // (same voices, on newsletters) is the more relevant next step.
  const heardInstant = engine === 'webspeech'
  const offerNatural = heardInstant && naturalAvailable === true

  return (
    <div
      className="jr-nudge-backdrop"
      role="presentation"
      onClick={() => {
        track(Events.NUDGE_DISMISS, { method: 'backdrop', engine })
        onClose()
      }}
    >
      <div
        className="jr-nudge"
        role="dialog"
        aria-labelledby="jr-nudge-title"
        onClick={(e) => e.stopPropagation()}
      >
        {offerNatural ? (
          <>
            <p className="jr-nudge-kicker">One more thing</p>
            <h2 id="jr-nudge-title" className="jr-nudge-title">
              That's the fast voice
            </h2>
            <p className="jr-nudge-body">
              Junco Reader also has Kokoro, a free on-device AI voice that sounds noticeably more
              natural. One-time download, then it's cached in this browser.
            </p>
            <div className="jr-nudge-actions">
              <button
                type="button"
                className="jr-btn jr-btn-primary"
                onClick={() => {
                  track(Events.NUDGE_TRY_NATURAL_CLICK)
                  onTryNatural?.()
                  onClose()
                }}
              >
                Try the Natural voice
              </button>
              <button
                type="button"
                className="jr-btn jr-btn-ghost"
                onClick={() => {
                  track(Events.NUDGE_DISMISS, { method: 'keep_reading', engine })
                  onClose()
                }}
              >
                Keep reading
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="jr-nudge-kicker">One more thing</p>
            <h2 id="jr-nudge-title" className="jr-nudge-title">
              Liked the voice?
            </h2>
            <p className="jr-nudge-body">
              Junco uses the same on-device Kokoro voices to turn your newsletters into a short
              daily podcast, free on iPhone.
            </p>
            <div className="jr-nudge-actions">
              <a
                className="jr-btn jr-btn-primary"
                href={APP_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  track(Events.NUDGE_APP_STORE_CLICK)
                  onClose()
                }}
              >
                Download Junco
              </a>
              <button
                type="button"
                className="jr-btn jr-btn-ghost"
                onClick={() => {
                  track(Events.NUDGE_DISMISS, { method: 'keep_reading', engine })
                  onClose()
                }}
              >
                Keep reading
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
