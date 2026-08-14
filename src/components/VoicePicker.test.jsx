import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import VoicePicker from './VoicePicker'

const localVoice = {
  name: 'Local voice',
  lang: 'en-US',
  voiceURI: 'local-en',
  localService: true,
}

describe('VoicePicker', () => {
  it('puts Natural first and marks it as the default selection', () => {
    const html = renderToStaticMarkup(
      <VoicePicker
        engine="kokoro"
        naturalAvailable
        instantUsable
        instantVoicesReady
        kokoroVoiceId="af_heart"
        webSpeechVoices={[localVoice]}
        webSpeechVoiceURI={localVoice.voiceURI}
      />,
    )

    expect(html.indexOf('>Natural</button>')).toBeLessThan(html.indexOf('>Instant</button>'))
    expect(html).toMatch(/aria-checked="true"[^>]*>Natural<\/button>/)
    expect(html).toMatch(/aria-checked="false"[^>]*>Instant<\/button>/)
  })

  it('disables Natural when WebGPU is unavailable and keeps a local Instant voice usable', () => {
    const html = renderToStaticMarkup(
      <VoicePicker
        engine="webspeech"
        naturalAvailable={false}
        naturalUnavailableHint="WebGPU required"
        instantUsable
        instantVoicesReady
        kokoroVoiceId="af_heart"
        webSpeechVoices={[localVoice]}
        webSpeechVoiceURI={localVoice.voiceURI}
      />,
    )

    expect(html).toMatch(/disabled=""[^>]*>Natural<\/button>/)
    expect(html).toContain('Local voice (en-US)')
  })
})
