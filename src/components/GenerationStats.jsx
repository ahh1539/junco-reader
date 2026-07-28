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
 * @param {{ stats: {
 *   voice?: string,
 *   device?: string,
 *   dtype?: string,
 *   chunksDone?: number,
 *   chunksTotal?: number,
 *   charsSpoken?: number,
 *   ttfaMs?: number | null,
 *   synthMs?: number | null,
 *   audioSec?: number | null,
 *   rtf?: number | null,
 *   live?: boolean,
 * } | null }} props
 */
export default function GenerationStats({ stats }) {
  if (!stats) return null

  const rows = [
    { label: 'Voice', value: stats.voice || '-' },
    { label: 'Engine', value: [stats.device, stats.dtype].filter(Boolean).join(' · ') || '-' },
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
  ]

  return (
    <section className="jr-stats" aria-label="Generation stats">
      <header className="jr-stats-head">
        <p className="jr-stats-kicker">Generation</p>
        <h3 className="jr-stats-title">
          {stats.live ? 'Live stats' : 'Last run'}
        </h3>
      </header>
      <dl className="jr-stats-grid">
        {rows.map((row) => (
          <div key={row.label} className="jr-stats-item">
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
