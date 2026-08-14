import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { Window } from 'happy-dom'
import { describe, expect, it } from 'vitest'

import ContentsRail from './ContentsRail'

describe('ContentsRail', () => {
  it('preserves EPUB-owned labels without adding spine-position numbering', () => {
    const html = renderToStaticMarkup(
      <ContentsRail
        chapters={[
          { id: 'title', title: 'Title Page', sections: [] },
          { id: 'one', title: '1. Broken and Divided', sections: [] },
        ]}
      />,
    )

    expect(html).toContain('Title Page')
    expect(html).toContain('1. Broken and Divided')
    expect(html).not.toContain('1. Title Page')
    expect(html).not.toContain('2. 1. Broken and Divided')
  })

  it('contains keyboard focus and closes the mobile dialog with Escape', () => {
    const testWindow = new Window({ url: 'https://example.test' })
    const container = testWindow.document.createElement('div')
    testWindow.document.body.append(container)
    const previousWindow = globalThis.window
    const previousDocument = globalThis.document
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.window = testWindow
    globalThis.document = testWindow.document
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const root = createRoot(container)

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <ContentsRail
          chapters={[{ id: 'one', title: 'Chapter one', sections: [] }]}
          mobileOpen={open}
          onMobileOpenChange={setOpen}
        />
      )
    }

    try {
      act(() => root.render(<Harness />))
      const trigger = container.querySelector('.jr-contents-mobile-trigger')
      act(() => trigger.click())

      const drawer = container.querySelector('.jr-contents-drawer')
      const close = drawer.querySelector('.jr-btn-ghost')
      const chapter = drawer.querySelector('.jr-contents-chapter')
      expect(drawer.getAttribute('aria-hidden')).toBe('false')
      expect(testWindow.document.activeElement).toBe(close)

      chapter.focus()
      act(() => {
        chapter.dispatchEvent(
          new testWindow.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
        )
      })
      expect(testWindow.document.activeElement).toBe(close)

      act(() => {
        testWindow.document.dispatchEvent(
          new testWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
        )
      })
      expect(drawer.getAttribute('aria-hidden')).toBe('true')
      expect(testWindow.document.activeElement).toBe(trigger)
    } finally {
      act(() => root.unmount())
      globalThis.window = previousWindow
      globalThis.document = previousDocument
      globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    }
  })
})
