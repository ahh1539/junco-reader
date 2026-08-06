import { memo } from 'react'
import './DocumentPreview.css'

function DocumentPreview({
  document,
  activeChunkIndex = -1,
  chunks = [],
  chapterIndex = 0,
  onChapterChange,
  bookProgressLabel,
}) {
  if (!document) return null

  const { name, kind, text, meta, chapters = [] } = document
  const isEpub = kind === 'epub'
  const kindLabel = kind === 'pdf' ? 'PDF' : kind === 'md' ? 'Markdown' : isEpub ? 'EPUB' : 'Text'
  const pages =
    meta?.pageCount != null ? ` / ${meta.pageCount} page${meta.pageCount === 1 ? '' : 's'}` : ''
  const activeChapter = isEpub ? chapters[chapterIndex] : null
  const title = isEpub ? meta?.title || name : name
  const characterCount = text.length.toLocaleString()

  return (
    <section className="jr-doc" aria-label="Document preview">
      <header className="jr-doc-head">
        <div>
          <p className="jr-doc-kicker">
            {kindLabel}
            {pages}
            {isEpub && meta?.creator ? ` / ${meta.creator}` : ''}
          </p>
          <h2 className="jr-doc-title">{title}</h2>
        </div>
        <p className="jr-doc-stats">
          {characterCount} characters
          {isEpub ? ` / ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}` : ''}
          {chunks.length ? ` / ${chunks.length} chunks` : ''}
        </p>
      </header>

      {isEpub ? (
        <div className="jr-chapter-nav">
          <label className="jr-chapter-select-label" htmlFor="jr-chapter-select">
            <span>Chapter</span>
            <select
              id="jr-chapter-select"
              className="jr-chapter-select"
              value={chapterIndex}
              onChange={(event) => onChapterChange?.(Number(event.target.value))}
            >
              {chapters.map((chapter, index) => (
                <option key={chapter.id} value={index}>
                  {index + 1}. {chapter.title}
                </option>
              ))}
            </select>
          </label>
          <p className="jr-chapter-progress">{bookProgressLabel || `Chapter ${chapterIndex + 1}`}</p>
        </div>
      ) : null}

      {activeChapter ? <h3 className="jr-doc-chapter-title">{activeChapter.title}</h3> : null}

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

export default memo(DocumentPreview)
