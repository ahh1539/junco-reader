import * as pdfjs from 'pdfjs-dist'

// Vite-friendly worker URL
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

/**
 * Extract plain text from a PDF File. Client-side only.
 * @param {File} file
 * @returns {Promise<{ text: string, pageCount: number }>}
 */
export async function extractPdfText(file) {
  const data = new Uint8Array(await file.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  const pages = []

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .filter(Boolean)
    pages.push(strings.join(' '))
  }

  const text = pages
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return { text, pageCount: doc.numPages }
}
