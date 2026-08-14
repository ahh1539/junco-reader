import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Window } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentPreview from './DocumentPreview'
import InteractiveChapterText from './InteractiveChapterText'

const chapter = {
  id: 'chapter-one',
  title: 'Chapter one',
  text: 'Opening\n\nFirst chunk. Second chunk.',
  sections: [{ id: 'opening', title: 'Opening', level: 2, charOffset: 0 }],
}

const chapterChunks = [
  { text: 'First chunk.', startOffset: 9, endOffset: 21, globalIndex: 7, localIndex: 0 },
  { text: 'Second chunk.', startOffset: 22, endOffset: 35, globalIndex: 8, localIndex: 1 },
]

let root
let container
let testWindow

function render(props = {}) {
  act(() => {
    root.render(
      <InteractiveChapterText
        chapter={chapter}
        chapterChunks={chapterChunks}
        onOptimizeForSpeechChange={() => {}}
        {...props}
      />,
    )
  })
}

beforeEach(() => {
  testWindow = new Window({ url: 'https://example.test' })
  container = testWindow.document.createElement('div')
  testWindow.document.body.append(container)

  vi.stubGlobal('window', testWindow)
  vi.stubGlobal('document', testWindow.document)
  vi.stubGlobal('HTMLElement', testWindow.HTMLElement)
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
})

describe('InteractiveChapterText', () => {
  it('uses global chunk indexes for narrated and selected highlights', () => {
    render({ activeChunkIndex: 7, selectedChunkIndex: 8 })

    expect(container.querySelector('[data-chunk="7"]').classList.contains('is-active')).toBe(true)
    expect(container.querySelector('[data-chunk="8"]').classList.contains('is-selected')).toBe(true)

    render({ activeChunkIndex: 8, selectedChunkIndex: 8 })
    const sharedTarget = container.querySelector('[data-chunk="8"]')
    expect(sharedTarget.classList.contains('is-active')).toBe(true)
    expect(sharedTarget.classList.contains('is-selected')).toBe(true)
    expect(container.querySelector('[data-chunk="7"]').classList.contains('is-past')).toBe(true)
  })

  it('queues chunks by mouse or keyboard but ignores clicks used to select text', () => {
    const onChunkSeek = vi.fn()
    render({ onChunkSeek })
    const chunk = container.querySelector('[data-chunk="8"]')

    vi.spyOn(testWindow, 'getSelection').mockReturnValue({ isCollapsed: false })
    act(() => chunk.click())
    expect(onChunkSeek).not.toHaveBeenCalled()

    testWindow.getSelection.mockReturnValue({ isCollapsed: true })
    act(() => chunk.click())
    expect(onChunkSeek).toHaveBeenLastCalledWith(8)

    act(() => {
      chunk.dispatchEvent(new testWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(onChunkSeek).toHaveBeenLastCalledWith(8)
    expect(onChunkSeek).toHaveBeenCalledTimes(2)
  })

  it('does not let a handled chunk shortcut reach the global playback listener', () => {
    const onChunkSeek = vi.fn()
    const onGlobalKey = vi.fn()
    testWindow.addEventListener('keydown', onGlobalKey)
    render({ onChunkSeek })

    const chunk = container.querySelector('[data-chunk="8"]')
    act(() => {
      chunk.dispatchEvent(
        new testWindow.KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          cancelable: true,
        }),
      )
    })

    expect(onChunkSeek).toHaveBeenCalledWith(8)
    expect(onGlobalKey).not.toHaveBeenCalled()
  })

  it('returns the full EPUB section record when a heading is selected', () => {
    const onSectionSelect = vi.fn()
    render({ onSectionSelect })

    act(() => container.querySelector('.jr-book-heading').click())
    expect(onSectionSelect).toHaveBeenCalledWith(chapter.sections[0])
  })

  it('scrolls to the selected target before the narrated chunk', () => {
    let scrollFrame
    const scrollTo = vi.fn()
    testWindow.HTMLElement.prototype.scrollTo = scrollTo
    testWindow.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this.dataset?.chunk === '8') {
        return { top: 500, height: 20, bottom: 520, left: 0, right: 100, width: 100 }
      }
      if (this.classList?.contains('jr-interactive-chapter')) {
        return { top: 0, height: 200, bottom: 200, left: 0, right: 100, width: 100 }
      }
      return { top: 0, height: 20, bottom: 20, left: 0, right: 100, width: 100 }
    }
    requestAnimationFrame.mockImplementation((callback) => {
      scrollFrame = callback
      return 1
    })

    render({ activeChunkIndex: 7, selectedChunkIndex: 8 })
    act(() => scrollFrame())

    expect(scrollTo).toHaveBeenCalledWith({ top: 410, behavior: 'auto' })
  })

  it('keeps Reader and Listening Room on the same interaction surface', () => {
    render({ variant: 'reader' })
    expect(container.querySelector('.jr-interactive-chapter')).not.toBeNull()
    expect(container.querySelector('.jr-interactive-chapter').classList.contains('is-reader')).toBe(true)

    render({ variant: 'room' })
    expect(container.querySelector('.jr-interactive-chapter').classList.contains('is-room')).toBe(true)
  })

  it('uses the shared surface only for EPUBs in the standard Reader view', () => {
    const onChunkSeek = vi.fn()
    act(() => {
      root.render(
        <DocumentPreview
          document={{
            kind: 'epub',
            name: 'book.epub',
            text: chapter.text,
            chapters: [chapter],
            meta: { title: 'Test book' },
          }}
          chunks={chapterChunks.map((chunk) => chunk.text)}
          chapterChunks={chapterChunks}
          onChunkSeek={onChunkSeek}
          onOptimizeForSpeechChange={() => {}}
        />,
      )
    })
    act(() => container.querySelector('[data-chunk="8"]').click())
    expect(onChunkSeek).toHaveBeenCalledWith(8)
    expect(container.querySelector('.jr-interactive-chapter.is-reader')).not.toBeNull()
    expect([...container.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'Chapter one',
    ])

    act(() => {
      root.render(
        <DocumentPreview
          document={{ kind: 'txt', name: 'notes.txt', text: 'Plain notes', meta: {} }}
          chunks={['Plain notes']}
          onOptimizeForSpeechChange={() => {}}
        />,
      )
    })
    expect(container.querySelector('.jr-interactive-chapter')).toBeNull()
    expect(container.querySelector('.jr-doc-chunk')?.textContent).toContain('Plain notes')
  })
})
