/**
 * Strip light Markdown to readable plain text for TTS.
 * Not a full MD parser; enough for common documents.
 */
export function markdownToPlainText(md) {
  return String(md || '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * @param {File} file
 * @returns {Promise<{ text: string, kind: 'txt' | 'md' | 'pdf', name: string }>}
 */
export async function extractFromFile(file) {
  const name = file.name || 'document'
  const lower = name.toLowerCase()

  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    const { extractPdfText } = await import('./extractPdf.js')
    const { text, pageCount } = await extractPdfText(file)
    if (!text) {
      throw new Error('Could not extract text from this PDF. It may be image-only.')
    }
    return { text, kind: 'pdf', name, meta: { pageCount } }
  }

  const raw = await file.text()
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return { text: markdownToPlainText(raw), kind: 'md', name }
  }

  return { text: raw.trim(), kind: 'txt', name }
}

export function extractFromPaste(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('Paste some text first.')
  // Heuristic: treat as markdown if it looks like it
  const looksMd = /^#{1,6}\s|^\*\s|\[.+]\(.+\)/m.test(text)
  return {
    text: looksMd ? markdownToPlainText(text) : text,
    kind: looksMd ? 'md' : 'txt',
    name: 'Pasted text',
  }
}
