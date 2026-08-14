import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import EpubViewToggle, {
  EPUB_VIEW_LISTENING_ROOM,
  EPUB_VIEW_READER,
} from './EpubViewToggle'

describe('EpubViewToggle', () => {
  it('exposes both EPUB views as an accessible single-choice control', () => {
    const html = renderToStaticMarkup(
      <EpubViewToggle value={EPUB_VIEW_LISTENING_ROOM} onChange={() => {}} />,
    )

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="EPUB view"')
    expect(html).toMatch(/aria-checked="true" aria-label="Listening Room"/)
    expect(html).toMatch(/aria-checked="false" aria-label="Reader"/)
    expect(html.indexOf('aria-label="Reader"')).toBeLessThan(
      html.indexOf('aria-label="Listening Room"'),
    )
  })

  it('marks Reader as selected when the reader view is active', () => {
    const html = renderToStaticMarkup(
      <EpubViewToggle value={EPUB_VIEW_READER} onChange={() => {}} />,
    )

    expect(html).toMatch(/aria-checked="true" aria-label="Reader"/)
  })
})
