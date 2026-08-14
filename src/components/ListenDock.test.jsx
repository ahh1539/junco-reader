import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import ListenDock from './ListenDock'

const voiceProps = {
  engine: 'kokoro',
  naturalAvailable: true,
  instantUsable: true,
  instantVoicesReady: true,
  kokoroVoiceId: 'af_heart',
  webSpeechVoices: [],
}

const commonProps = {
  ready: false,
  playing: false,
  paused: false,
  progressLabel: null,
  chapterTitle: 'Chapter one',
  voiceProps,
  speed: 1,
  onSpeedChange: () => {},
  onPlay: () => {},
  onPause: () => {},
  onResume: () => {},
  onStop: () => {},
  onPrevChapter: () => {},
  onNextChapter: () => {},
  onPrevSection: () => {},
  onNextSection: () => {},
}

describe('ListenDock', () => {
  it('offers the client-fetched Natural download and zero-download Instant fallback', () => {
    const html = renderToStaticMarkup(
      <ListenDock
        {...commonProps}
        onListenInstantly={() => {}}
        modelDownloadProps={{
          status: 'needed',
          displaySize: '~326 MB',
          onDownload: () => {},
        }}
      />,
    )

    expect(html).toContain('Download Natural voice')
    expect(html).toContain('~326 MB')
    expect(html).toContain('Listen instantly')
    expect(html).toContain('No download — browser voice')
  })

  it('renders the full chapter/section transport only when the engine is ready', () => {
    const html = renderToStaticMarkup(
      <ListenDock
        {...commonProps}
        ready
        canPrevChapter
        canNextChapter
        canPrevSection
        canNextSection
        modelDownloadProps={{ status: 'ready', onRemove: () => {} }}
      />,
    )

    for (const label of [
      'Previous chapter',
      'Previous section',
      'Listen',
      'Next section',
      'Next chapter',
      'Stop',
    ]) {
      expect(html).toContain(`aria-label="${label}"`)
    }
  })
})
