import { useCallback, useState } from 'react'
import './DropZone.css'

const ACCEPT =
  '.pdf,.epub,.txt,.md,.markdown,text/plain,application/pdf,application/epub+zip,text/markdown'

export default function DropZone({ onFile, disabled }) {
  const [dragging, setDragging] = useState(false)

  const handleFiles = useCallback(
    (files) => {
      const file = files?.[0]
      if (file) onFile(file)
    },
    [onFile],
  )

  return (
    <label
      className={`jr-drop ${dragging ? 'is-dragging' : ''} ${disabled ? 'is-disabled' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) handleFiles(e.dataTransfer.files)
      }}
    >
      <input
        type="file"
        accept={ACCEPT}
        disabled={disabled}
        className="jr-drop-input"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <span className="jr-drop-mark" aria-hidden="true">
        ↘
      </span>
      <span className="jr-drop-title">Drop a PDF, EPUB, TXT, or Markdown file</span>
      <span className="jr-drop-sub">or click to browse. Junco does not upload or persist document contents.</span>
    </label>
  )
}
