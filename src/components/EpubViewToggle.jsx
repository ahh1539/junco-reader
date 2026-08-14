import './EpubViewToggle.css'

export const EPUB_VIEW_LISTENING_ROOM = 'listening-room'
export const EPUB_VIEW_READER = 'reader'

const VIEWS = [
  {
    id: EPUB_VIEW_READER,
    label: 'Reader',
    shortLabel: 'Read',
  },
  {
    id: EPUB_VIEW_LISTENING_ROOM,
    label: 'Listening Room',
    shortLabel: 'Listen',
  },
]

export default function EpubViewToggle({ value, onChange }) {
  return (
    <div className="jr-epub-view-toggle" role="radiogroup" aria-label="EPUB view">
      {VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          role="radio"
          aria-checked={value === view.id}
          aria-label={view.label}
          className={value === view.id ? 'is-active' : ''}
          onClick={() => onChange?.(view.id)}
        >
          <span className="jr-view-label-long" aria-hidden="true">{view.label}</span>
          <span className="jr-view-label-short" aria-hidden="true">{view.shortLabel}</span>
        </button>
      ))}
    </div>
  )
}
