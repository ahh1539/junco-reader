import './DocumentPreview.css'

export default function DocumentPreview({
  document,
  activeChunkIndex = -1,
  chunks = [],
}) {
  if (!document) return null

  const { name, kind, text, meta } = document
  const kindLabel = kind === 'pdf' ? 'PDF' : kind === 'md' ? 'Markdown' : 'Text'
  const pages =
    meta?.pageCount != null ? ` · ${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'}` : ''

  return (
    <section className="jr-doc" aria-label="Document preview">
      <header className="jr-doc-head">
        <div>
          <p className="jr-doc-kicker">
            {kindLabel}
            {pages}
          </p>
          <h2 className="jr-doc-title">{name}</h2>
        </div>
        <p className="jr-doc-stats">
          {text.length.toLocaleString()} characters
          {chunks.length ? ` · ${chunks.length} chunks` : ''}
        </p>
      </header>

      <div className="jr-doc-body" tabIndex={0}>
        {chunks.length > 0 ? (
          chunks.map((chunk, i) => (
            <span
              key={i}
              className={`jr-doc-chunk ${i === activeChunkIndex ? 'is-active' : ''} ${i < activeChunkIndex ? 'is-past' : ''}`}
            >
              {chunk}
              {i < chunks.length - 1 ? ' ' : ''}
            </span>
          ))
        ) : (
          <p className="jr-doc-plain">{text}</p>
        )}
      </div>
    </section>
  )
}
