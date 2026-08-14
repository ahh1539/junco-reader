import { fingerprintEpubBytes } from './epubProgress.js'

const EPUB_MIMETYPE = 'application/epub+zip'
const MAX_TEXT_ENTRY_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_TEXT_BYTES = 48 * 1024 * 1024
const TEXT_ENTRY_RE = /(?:^mimetype$|\.xml$|\.opf$|\.ncx$|\.x?html?$)/i

function decodePath(path) {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

function normalizePath(path) {
  const parts = []
  for (const part of decodePath(path).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  return parts.join('/')
}

function resolveArchivePath(basePath, reference) {
  const raw = String(reference || '').split(/[?#]/, 1)[0]
  if (!raw) return normalizePath(basePath)
  const parent = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/') + 1) : ''
  return normalizePath(raw.startsWith('/') ? raw.slice(1) : `${parent}${raw}`)
}

function getEntry(archive, path) {
  return archive[path] || archive[decodePath(path)] || archive[encodeURI(path)] || null
}

function isCandidateTextEntry(file) {
  const path = normalizePath(file.name || '')
  if (!TEXT_ENTRY_RE.test(path)) return false
  return true
}

function unzipTextEntries(unzipSync, bytes) {
  let totalTextBytes = 0
  let exceededTextLimit = false
  const archive = unzipSync(bytes, {
    // EPUBs commonly contain high-resolution covers and illustrations. Only
    // inflate XML/XHTML resources needed for narration, never image/font/CSS
    // payloads, and put a ceiling on untrusted decompressed text.
    filter(file) {
      if (!isCandidateTextEntry(file)) return false
      const size = Number(file.originalSize || 0)
      if (size > MAX_TEXT_ENTRY_BYTES || totalTextBytes + size > MAX_TOTAL_TEXT_BYTES) {
        exceededTextLimit = true
        return false
      }
      totalTextBytes += size
      return true
    },
  })
  if (exceededTextLimit) {
    throw new Error('This EPUB has too much text to open safely in the browser.')
  }
  return archive
}

function elementList(node, localName) {
  return Array.from(node.getElementsByTagName('*')).filter(
    (element) => localName === '*' || element.localName?.toLowerCase() === localName,
  )
}

function firstElement(node, localName) {
  return elementList(node, localName)[0] || null
}

function textOf(element) {
  return element?.textContent?.replace(/\s+/g, ' ').trim() || ''
}

function parseXml(markup, label) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('Your browser cannot read EPUB files yet. Try a current browser and try again.')
  }
  // The bytes have already been decoded. Dropping the optional declaration
  // avoids parser inconsistencies around otherwise-valid single-quoted XML
  // declarations found in older EPUB 2/Kindle conversions.
  const xml = String(markup || '').replace(/^\uFEFF?\s*<\?xml[^?]*\?>\s*/i, '')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (firstElement(doc, 'parsererror')) {
    throw new Error(`Could not read ${label} in this EPUB.`)
  }
  return doc
}

function parseChapter(markup) {
  const xml = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
  if (!firstElement(xml, 'parsererror')) return xml
  return new DOMParser().parseFromString(markup, 'text/html')
}

function cleanedChapterRoot(doc) {
  const root = doc.body || firstElement(doc, 'body') || doc.documentElement
  if (!root) return null
  const clone = root.cloneNode(true)
  const removable = new Set([
    'script',
    'style',
    'noscript',
    'template',
    'nav',
    'svg',
    'math',
    'audio',
    'video',
    'iframe',
    'form',
  ])
  elementList(clone, '*').forEach((node) => {
    if (removable.has(node.localName?.toLowerCase())) node.remove()
  })
  elementList(clone, 'br').forEach((node) => node.replaceWith('\n'))
  elementList(clone, 'img').forEach((node) => {
    if (node.getAttribute('alt')) node.replaceWith(` ${node.getAttribute('alt')} `)
  })
  return clone
}

function normalizeChapterText(raw) {
  return String(raw || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function chapterText(doc) {
  const clone = cleanedChapterRoot(doc)
  if (!clone) return ''

  const blockNames = new Set(
    'address article aside blockquote dd div dl dt figcaption figure footer h1 h2 h3 h4 h5 h6 header li main ol p pre section table td th tr ul'.split(
      ' ',
    ),
  )
  const blocks = elementList(clone, '*').filter((node) => blockNames.has(node.localName?.toLowerCase()))
  blocks.forEach((node) => {
    node.before('\n')
    node.after('\n')
  })

  return normalizeChapterText(clone.textContent || '')
}

function chapterHeading(doc) {
  const heading = elementList(doc, '*').find((element) => /^(h1|h2|h3)$/i.test(element.localName))
  return textOf(heading)
}

function semanticSpineTitle(item, archivePath) {
  const hint = `${item?.id || ''} ${archivePath.split('/').pop() || ''}`
    .replace(/\.x?html?$/i, '')
    .toLowerCase()
  if (/mini[-_ ]?toc/.test(hint)) return 'Book Navigation'
  if (/front[-_ ]?matter/.test(hint)) return 'Front Matter'
  if (/back[-_ ]?matter/.test(hint)) return 'Back Matter'
  if (/copyright/.test(hint)) return 'Copyright Notice'
  if (/acknowledg/.test(hint)) return 'Acknowledgments'
  if (/dedication/.test(hint)) return 'Dedication'
  if (/about[-_ ]?(the[-_ ]?)?author/.test(hint)) return 'About the Author'
  if (/\bpreface\b/.test(hint)) return 'Preface'
  if (/\bprologue\b/.test(hint)) return 'Prologue'
  if (/\bepilogue\b/.test(hint)) return 'Epilogue'
  if (/\bcontents?\b|\btoc\b/.test(hint)) return 'Contents'
  return ''
}

/**
 * Collect in-chapter headings with character offsets into the whitespace-
 * collapsed chapter text (same space as chunkTextWithOffsets), so the
 * Listening Room can jump to sections on a page.
 */
function chapterSections(doc, text) {
  if (!text) return []
  const clone = cleanedChapterRoot(doc)
  if (!clone) return []

  const normalized = text.replace(/\s+/g, ' ').trim()
  const headings = elementList(clone, '*').filter((element) =>
    /^(h1|h2|h3)$/i.test(element.localName || ''),
  )
  const sections = []
  let searchFrom = 0

  headings.forEach((heading, index) => {
    const title = textOf(heading)
    if (!title) return
    const foundAt = normalized.indexOf(title, searchFrom)
    if (foundAt === -1) return
    const level = Number(String(heading.localName).replace(/\D/g, '') || 2)
    sections.push({
      id: `section-${index}-${foundAt}`,
      title,
      level: Number.isFinite(level) ? level : 2,
      charOffset: foundAt,
    })
    searchFrom = foundAt + title.length
  })

  return sections
}

function buildTocTitles(archive, opfPath, manifest, spine) {
  const titles = new Map()
  const titlePriorities = new Map()
  const navItem = [...manifest.values()].find((item) => /(^|\s)nav(\s|$)/.test(item.properties))
  const spineTocId = spine.getAttribute('toc')
  const ncxItem = spineTocId ? manifest.get(spineTocId) : null
  const tocItem = navItem || ncxItem || [...manifest.values()].find((item) => item.mediaType.includes('ncx'))
  if (!tocItem) return titles

  const tocPath = resolveArchivePath(opfPath, tocItem.href)
  const contents = getEntry(archive, tocPath)
  if (!contents) return titles

  const rememberTitle = (target, label) => {
    if (!target || !label) return
    const path = resolveArchivePath(tocPath, target)
    // A fragmentless TOC entry names the whole spine document and is a better
    // chapter label than a nested anchor within it. Some older conversions put
    // an illustration and a numbered chapter in the same XHTML file; in that
    // case prefer the chapter label. For equal candidates keep reading order.
    const isWholeDocument = !String(target).includes('#')
    const isNumberedChapter = /^(?:chapter\s+)?\d+\b|^[ivxlcdm]+[-.]\d+\b/i.test(label)
    const priority = isWholeDocument ? 3 : isNumberedChapter ? 2 : 1
    if ((titlePriorities.get(path) || 0) >= priority) return
    titlePriorities.set(path, priority)
    titles.set(path, label)
  }

  try {
    const doc = parseXml(new TextDecoder().decode(contents), 'table of contents')
    if (tocItem.mediaType.includes('ncx')) {
      for (const navPoint of elementList(doc, 'navpoint')) {
        const content = firstElement(navPoint, 'content')
        const target = content?.getAttribute('src')
        const label = textOf(firstElement(firstElement(navPoint, 'navlabel') || navPoint, 'text'))
        rememberTitle(target, label)
      }
    } else {
      const EPUB_NS = 'http://www.idpf.org/2007/ops'
      const navs = elementList(doc, 'nav')
      const tocNav =
        navs.find((nav) => {
          const type =
            nav.getAttributeNS?.(EPUB_NS, 'type') ||
            nav.getAttribute('epub:type') ||
            nav.getAttribute('type') ||
            ''
          return String(type).split(/\s+/).includes('toc')
        }) || navs[0]
      // EPUB navigation documents may also contain landmarks and hundreds of
      // print page-number links. Those targets often point into chapter files;
      // treating every <a> as a title lets "42" overwrite "Chapter 2".
      const tocLinks = tocNav ? elementList(tocNav, 'a') : []
      for (const link of tocLinks.filter((element) => element.getAttribute('href'))) {
        const target = link.getAttribute('href')
        const label = textOf(link)
        rememberTitle(target, label)
      }
    }
  } catch {
    // A malformed optional navigation document should not make readable spine
    // content unavailable. Section headings provide the fallback title.
  }
  return titles
}

function likelyDrmLocked(archive) {
  const encryption = getEntry(archive, 'META-INF/encryption.xml')
  if (!encryption) return false
  const text = new TextDecoder().decode(encryption).toLowerCase()
  return /adobe\.com\/adept|readium\.org\/lcp|\.lcp\b|fairplay|kindle/.test(text)
}

/**
 * Read a DRM-free EPUB into local text chapters. No markup is rendered and no
 * book data leaves the browser.
 *
 * @param {File} file
 * @returns {Promise<{ text: string, kind: 'epub', name: string, chapters: { id: string, title: string, text: string, sections: { id: string, title: string, level: number, charOffset: number }[] }[], meta: { title: string, creator: string, fingerprint: string } }>}
 */
export async function extractEpubText(file) {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let unzipSync
  try {
    ;({ unzipSync } = await import('fflate'))
  } catch {
    throw new Error('Could not load EPUB support. Check your connection and try again.')
  }

  let archive
  try {
    archive = unzipTextEntries(unzipSync, bytes)
  } catch (error) {
    if (error?.message?.includes('too much text')) throw error
    throw new Error('This file is not a valid EPUB archive.')
  }

  const mimetype = getEntry(archive, 'mimetype')
  if (mimetype && new TextDecoder().decode(mimetype).trim() !== EPUB_MIMETYPE) {
    throw new Error('This ZIP file is not an EPUB.')
  }
  if (likelyDrmLocked(archive)) {
    throw new Error('This EPUB appears to be DRM-protected. Junco Reader can open DRM-free EPUBs only.')
  }

  const container = getEntry(archive, 'META-INF/container.xml')
  if (!container) throw new Error('This EPUB is missing its package information.')

  let containerDoc
  try {
    containerDoc = parseXml(new TextDecoder().decode(container), 'package information')
  } catch (error) {
    throw new Error(error?.message || 'Could not read this EPUB package.')
  }
  const rootFile = firstElement(containerDoc, 'rootfile')
  const opfPath = rootFile?.getAttribute('full-path')
  if (!opfPath) throw new Error('This EPUB does not identify its reading order.')

  const opfContents = getEntry(archive, normalizePath(opfPath))
  if (!opfContents) throw new Error('This EPUB package could not be found.')

  let opf
  try {
    opf = parseXml(new TextDecoder().decode(opfContents), 'book metadata')
  } catch (error) {
    throw new Error(error?.message || 'Could not read this EPUB metadata.')
  }

  const manifest = new Map(
    elementList(opf, 'item')
      .filter((item) => item.getAttribute('id') && item.getAttribute('href'))
      .map((item) => [
        item.getAttribute('id'),
        {
          id: item.getAttribute('id'),
          href: item.getAttribute('href'),
          mediaType: item.getAttribute('media-type') || '',
          properties: item.getAttribute('properties') || '',
        },
      ]),
  )
  const spine = firstElement(opf, 'spine')
  if (!spine || !manifest.size) throw new Error('This EPUB has no readable chapters.')

  const tocTitles = buildTocTitles(archive, normalizePath(opfPath), manifest, spine)
  const chapters = []
  for (const itemRef of Array.from(spine.children).filter((item) => item.localName === 'itemref')) {
    if (itemRef.getAttribute('linear') === 'no') continue
    const item = manifest.get(itemRef.getAttribute('idref'))
    if (!item) continue
    const path = resolveArchivePath(normalizePath(opfPath), item.href)
    const contents = getEntry(archive, path)
    if (!contents) continue

    try {
      const chapterDoc = parseChapter(new TextDecoder().decode(contents))
      const text = chapterText(chapterDoc)
      if (!text) continue
      chapters.push({
        id: item.id || path,
        title:
          tocTitles.get(path) ||
          chapterHeading(chapterDoc) ||
          semanticSpineTitle(item, path) ||
          `Chapter ${chapters.length + 1}`,
        text,
        sections: chapterSections(chapterDoc, text),
      })
    } catch {
      // EPUBs often contain a non-content spine file. Ignore an individual
      // unreadable section if the rest of the book is intact.
    }
  }

  if (!chapters.length) {
    throw new Error('Could not find readable text in this EPUB. It may be image-only or protected.')
  }

  const metadata = firstElement(opf, 'metadata') || opf
  const title = textOf(firstElement(metadata, 'title')) || file.name.replace(/\.epub$/i, '') || 'Untitled book'
  const creator = textOf(firstElement(metadata, 'creator'))
  const fingerprint = await fingerprintEpubBytes(buffer)

  return {
    text: chapters.map((chapter) => chapter.text).join('\n\n'),
    kind: 'epub',
    name: file.name || title,
    chapters,
    meta: { title, creator, fingerprint },
  }
}
