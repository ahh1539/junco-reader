import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Window } from 'happy-dom'
import { strToU8, zipSync } from 'fflate'

import { extractEpubText } from './extractEpub'

function epubArchive(extraEntries = {}) {
  return zipSync({
    mimetype: strToU8('application/epub+zip'),
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
      </container>`),
    'OEBPS/content.opf': strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
          <dc:title>The Test Book</dc:title><dc:creator>Ada Reader</dc:creator>
        </metadata>
        <manifest>
          <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
          <item id="front" href="front.xhtml" media-type="application/xhtml+xml" />
          <item id="one" href="chapters/one.xhtml" media-type="application/xhtml+xml" />
          <item id="two" href="chapters/two.xhtml" media-type="application/xhtml+xml" />
        </manifest>
        <spine><itemref idref="front" linear="no" /><itemref idref="one" /><itemref idref="two" /></spine>
      </package>`),
    'OEBPS/nav.xhtml': strToU8(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol>
        <li><a href="chapters/one.xhtml">A beginning</a></li>
        <li><a href="chapters/one.xhtml#map">Opening map</a></li>
        <li><a href="chapters/two.xhtml#sketch">Sketchbook</a></li>
        <li><a href="chapters/two.xhtml#part">2. The end</a></li>
      </ol></nav><nav epub:type="landmarks"><ol>
        <li><a href="chapters/one.xhtml">Start reading</a></li>
      </ol></nav><nav epub:type="page-list"><ol>
        <li><a href="chapters/one.xhtml#page-5">5</a></li>
        <li><a href="chapters/two.xhtml#page-12">12</a></li>
      </ol></nav></body></html>`),
    'OEBPS/front.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><body>Hidden front matter</body></html>'),
    'OEBPS/chapters/one.xhtml': strToU8(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><body>
        <nav>Navigation should not be spoken</nav><h1>Wrong heading</h1>
        <p>First <strong>chapter</strong>.</p><img alt="Moon map" /><script>ignore this</script>
      </body></html>`),
    'OEBPS/chapters/two.xhtml': strToU8(`<?xml version="1.0"?>
      <html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Last words</h1><p>Second chapter.</p></body></html>`),
    ...extraEntries,
  })
}

function fileFrom(bytes, name = 'book.epub') {
  return {
    name,
    type: 'application/epub+zip',
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  }
}

beforeEach(() => {
  const window = new Window()
  vi.stubGlobal('DOMParser', window.DOMParser)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractEpubText', () => {
  it('reads metadata and readable chapters in spine order without rendering markup', async () => {
    const document = await extractEpubText(fileFrom(epubArchive()))

    expect(document.kind).toBe('epub')
    expect(document.meta).toMatchObject({ title: 'The Test Book', creator: 'Ada Reader' })
    expect(document.meta.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(document.chapters.map((chapter) => chapter.title)).toEqual(['A beginning', '2. The end'])
    expect(document.chapters[0].text).toContain('First chapter.')
    expect(document.chapters[0].text).toContain('Moon map')
    expect(document.chapters[0].sections?.[0]).toMatchObject({
      title: 'Wrong heading',
      level: 1,
      charOffset: 0,
    })
    expect(document.chapters[1].sections?.[0]).toMatchObject({
      title: 'Last words',
      level: 1,
    })
    expect(document.chapters[0].text).not.toContain('Navigation should not be spoken')
    expect(document.chapters[0].text).not.toContain('ignore this')
    expect(document.chapters[0].sections?.[0]).toMatchObject({
      title: 'Wrong heading',
      level: 1,
    })
    expect(document.chapters[1].sections?.[0]).toMatchObject({
      title: 'Last words',
      level: 1,
    })
    expect(document.text.indexOf('First chapter.')).toBeLessThan(document.text.indexOf('Second chapter.'))
    expect(document.text).not.toContain('Hidden front matter')
  })

  it('ignores EPUB page-list and landmark labels when assigning chapter titles', async () => {
    const document = await extractEpubText(fileFrom(epubArchive()))

    expect(document.chapters.map((chapter) => chapter.title)).toEqual(['A beginning', '2. The end'])
    expect(document.chapters.map((chapter) => chapter.title)).not.toContain('5')
    expect(document.chapters.map((chapter) => chapter.title)).not.toContain('Start reading')
  })

  it('rejects likely DRM-protected EPUBs before reading chapters', async () => {
    const file = fileFrom(
      epubArchive({
        'META-INF/encryption.xml': strToU8('<encryption>https://www.adobe.com/adept</encryption>'),
      }),
    )

    await expect(extractEpubText(file)).rejects.toThrow(/DRM-protected/)
  })

  it('rejects corrupt archives with a useful error', async () => {
    await expect(extractEpubText(fileFrom(new Uint8Array([1, 2, 3])))).rejects.toThrow(/valid EPUB archive/)
  })
})
