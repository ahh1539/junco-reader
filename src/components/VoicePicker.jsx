import { VOICES } from '../lib/voices'
import './VoicePicker.css'

/**
 * Engine choice + voice choice for whichever engine is active. "Natural"
 * (Kokoro, on-device) is the default, needing a one-time model download via
 * ModelDownloadButton; "Instant" (Web Speech, browser-native) is a
 * zero-download fallback.
 */
export default function VoicePicker({
  engine,
  onEngineChange,
  webSpeechSupported = true,
  kokoroVoiceId,
  onKokoroVoiceChange,
  webSpeechVoices = [],
  webSpeechVoiceURI,
  onWebSpeechVoiceChange,
  disabled,
}) {
  return (
    <div className="jr-voice">
      <span className="jr-voice-label">Voice</span>

      <div className="jr-voice-engine" role="radiogroup" aria-label="Voice engine">
        <button
          type="button"
          role="radio"
          aria-checked={engine === 'kokoro'}
          className={`jr-voice-engine-btn ${engine === 'kokoro' ? 'is-active' : ''}`}
          onClick={() => onEngineChange('kokoro')}
          disabled={disabled}
        >
          Natural
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={engine === 'webspeech'}
          className={`jr-voice-engine-btn ${engine === 'webspeech' ? 'is-active' : ''}`}
          onClick={() => onEngineChange('webspeech')}
          disabled={disabled || !webSpeechSupported}
          title={!webSpeechSupported ? "Your browser doesn't support instant playback" : undefined}
        >
          Instant
        </button>
      </div>

      {engine === 'webspeech' ? (
        webSpeechVoices.length ? (
          <select
            value={webSpeechVoiceURI || ''}
            disabled={disabled}
            onChange={(e) => onWebSpeechVoiceChange(e.target.value)}
            className="jr-voice-select"
            aria-label="Instant voice"
          >
            {webSpeechVoices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        ) : (
          <p className="jr-voice-empty">Uses your browser&rsquo;s default voice.</p>
        )
      ) : (
        <select
          value={kokoroVoiceId}
          disabled={disabled}
          onChange={(e) => onKokoroVoiceChange(e.target.value)}
          className="jr-voice-select"
          aria-label="Natural voice"
        >
          {VOICES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.displayName}
              {v.note ? ` (${v.note})` : ''} / {v.accent} {v.gender}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
