import { describe, expect, it, vi } from 'vitest'

import { normalizeTool } from './webmcp.js'
import { epubChapterListing } from './webmcpListing.js'
import {
  buildWebMcpTools,
  connectWebMcpTools,
  webMcpToolNames,
} from './webmcpTools.js'

function actionsRef(overrides = {}) {
  return { current: overrides }
}

describe('webMcpToolNames', () => {
  it('keeps always-on tools separate from document and EPUB tools', () => {
    const names = webMcpToolNames()
    expect(names.always).toEqual([
      'get_reader_status',
      'load_sample_document',
      'open_pasted_text',
      'set_engine',
      'set_voice',
      'set_speed',
      'download_natural_model',
      'clear_natural_model',
    ])
    expect(names.whenDocumentLoaded).toEqual(['play', 'pause', 'stop'])
    expect(names.whenEpub).toEqual([
      'list_chapters',
      'seek_chapter',
      'play_from_section',
      'resume_saved_position',
      'clear_saved_position',
    ])
  })
})

describe('tool annotations', () => {
  it('marks status and chapter listing as read-only', () => {
    const { always, whenEpub } = buildWebMcpTools(actionsRef())
    const status = always.find((tool) => tool.name === 'get_reader_status')
    const chapters = whenEpub.find((tool) => tool.name === 'list_chapters')
    expect(status.annotations).toMatchObject({ readOnlyHint: true })
    expect(chapters.annotations).toMatchObject({ readOnlyHint: true })
  })

  it('marks paste and model tools as mutating, with untrusted paste input', () => {
    const { always } = buildWebMcpTools(actionsRef())
    const paste = always.find((tool) => tool.name === 'open_pasted_text')
    const download = always.find((tool) => tool.name === 'download_natural_model')
    const clear = always.find((tool) => tool.name === 'clear_natural_model')
    expect(paste.annotations).toMatchObject({
      readOnlyHint: false,
      untrustedContentHint: true,
    })
    expect(download.annotations.readOnlyHint).toBe(false)
    expect(clear.annotations.readOnlyHint).toBe(false)
  })
})

describe('tool execute', () => {
  it('calls through to the latest actions on the ref', async () => {
    const getStatus = vi.fn(() => ({ playing: false, engine: 'natural' }))
    const play = vi.fn(() => ({ playing: true }))
    const ref = actionsRef({ getStatus, play })
    const { always, whenDocumentLoaded } = buildWebMcpTools(ref)

    const statusTool = normalizeTool(always.find((tool) => tool.name === 'get_reader_status'))
    const playTool = normalizeTool(whenDocumentLoaded.find((tool) => tool.name === 'play'))

    expect(JSON.parse(await statusTool.execute({}))).toEqual({
      ok: true,
      playing: false,
      engine: 'natural',
    })
    expect(JSON.parse(await playTool.execute({}))).toEqual({ ok: true, playing: true })
    expect(getStatus).toHaveBeenCalledOnce()
    expect(play).toHaveBeenCalledOnce()
  })

  it('forwards paste text and speed to actions', async () => {
    const openPastedText = vi.fn((text) => ({ kind: 'txt', name: 'Pasted text', preview: text }))
    const setSpeed = vi.fn((speed) => ({ speed }))
    const ref = actionsRef({ openPastedText, setSpeed })
    const { always } = buildWebMcpTools(ref)
    const pasteTool = normalizeTool(always.find((tool) => tool.name === 'open_pasted_text'))
    const speedTool = normalizeTool(always.find((tool) => tool.name === 'set_speed'))

    await pasteTool.execute({ text: 'Hello from an agent' })
    await speedTool.execute({ speed: 1.25 })
    expect(openPastedText).toHaveBeenCalledWith('Hello from an agent')
    expect(setSpeed).toHaveBeenCalledWith(1.25)
  })

  it('tells agents that listing and status tools omit document contents', () => {
    const { always, whenEpub } = buildWebMcpTools(actionsRef())
    const status = always.find((tool) => tool.name === 'get_reader_status')
    const chapters = whenEpub.find((tool) => tool.name === 'list_chapters')
    expect(status.description).toMatch(/never document text/i)
    expect(chapters.description).toMatch(/never chapter body text/i)
  })
})

describe('epubChapterListing', () => {
  it('returns titles and indices without chapter or section body text', () => {
    const listing = epubChapterListing({
      kind: 'epub',
      name: 'Book.epub',
      meta: { title: 'Moby-Dick', creator: 'Herman Melville' },
      chapters: [
        {
          id: 'c1',
          title: 'Loomings',
          text: 'Call me Ishmael. Some years ago—never mind how long precisely—',
          sections: [{ id: 's1', title: 'Opening', text: 'secret body' }],
        },
      ],
    })

    expect(listing).toEqual({
      title: 'Moby-Dick',
      creator: 'Herman Melville',
      chapters: [
        {
          chapter: 1,
          title: 'Loomings',
          sections: [{ id: 's1', title: 'Opening' }],
        },
      ],
    })
    expect(JSON.stringify(listing)).not.toMatch(/Ishmael/)
    expect(JSON.stringify(listing)).not.toMatch(/secret body/)
  })

  it('rejects non-EPUB documents', () => {
    expect(() => epubChapterListing({ kind: 'pdf', name: 'a.pdf' })).toThrow(/EPUB/)
  })
})

describe('connectWebMcpTools', () => {
  it('registers always-on tools and adds playback tools only when a document is open', async () => {
    const registered = new Map()
    const context = {
      registerTool: vi.fn(async (tool, { signal } = {}) => {
        registered.set(tool.name, tool)
        signal?.addEventListener('abort', () => registered.delete(tool.name), { once: true })
      }),
    }

    const stop = connectWebMcpTools(actionsRef(), { context })
    await vi.waitFor(() => {
      expect(registered.has('get_reader_status')).toBe(true)
    })
    expect(registered.has('play')).toBe(false)

    stop()
    const stopWithDoc = connectWebMcpTools(actionsRef(), { context, hasDocument: true })
    await vi.waitFor(() => {
      expect(registered.has('play')).toBe(true)
    })
    expect(registered.has('list_chapters')).toBe(false)
    stopWithDoc()
  })
})
