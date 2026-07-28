import { useId, useState } from 'react'
import './GenerationStats.css'

function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return '-'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

function formatSec(sec) {
  if (sec == null || Number.isNaN(sec)) return '-'
  if (sec < 60) return `${sec.toFixed(1)} s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}m ${s}s`
}

/**
 * Collapsed by default; expands for power users who want generation detail.
 */
export default function GenerationStats({ stats }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)

  if (!stats) return null

  const rows = [
    { label: 'Voice', value: stats.voice || '-' },
    { label: 'Engine', value: [stats.device, stats.dtype].filter(Boolean).join(' / ') || '-' },
    { label: 'Playback speed', value: stats.speed ? `${stats.speed}x` : '-' },
    {
      label: 'Chunks',
      value:
        stats.chunksTotal != null
          ? `${stats.chunksDone ?? 0} / ${stats.chunksTotal}`
          : '-',
    },
    {
      label: 'Chars spoken',
      value: stats.charsSpoken != null ? stats.charsSpoken.toLocaleString() : '-',
    },
    { label: 'Time to first audio', value: formatMs(stats.ttfaMs) },
    { label: 'Synth time', value: formatMs(stats.synthMs) },
    { label: 'Audio produced', value: formatSec(stats.audioSec) },
    {
      label: 'Real-time factor',
      value:
        stats.rtf != null && !Number.isNaN(stats.rtf)
          ? `${stats.rtf.toFixed(2)}x${stats.rtf < 1 ? ' (faster than real-time)' : ''}`
          : '-',
    },
    {
      label: 'Buffer underruns',
      value: stats.underruns != null ? String(stats.underruns) : '-',
    },
  ]

  const summary = stats.live
    ? `Generating${stats.chunksTotal != null ? ` (${stats.chunksDone ?? 0}/${stats.chunksTotal})` : ''}`
    : stats.ttfaMs != null
      ? `Last run: first audio in ${formatMs(stats.ttfaMs)}`
      : 'Last run'

  return (
    <section className={`jr-stats ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="jr-stats-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="jr-stats-toggle-copy">
          <span className="jr-stats-kicker">Details</span>
          <span className="jr-stats-summary">{summary}</span>
        </span>
        <span className="jr-stats-chevron" aria-hidden="true">
          {'>'}
        </span>
      </button>

      {open ? (
        <div id={panelId} className="jr-stats-panel">
          <dl className="jr-stats-grid">
            {rows.map((row) => (
              <div key={row.label} className="jr-stats-item">
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  )
}
