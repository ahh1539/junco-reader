import { VOICES } from '../lib/voices'
import './VoicePicker.css'

/**
 * Engine choice + voice choice for whichever engine is active. Natural
 * (Kokoro) is preferred when WebGPU is available; Instant uses only local
 * Web Speech voices as the zero-download fallback.
 */
export default function VoicePicker({
  engine,
  onEngineChange,
  webSpeechSupported = true,
  instantUsable = false,
  instantVoicesReady = false,
  naturalAvailable = null,
  naturalUnavailableHint,
  instantEmptyHint,
  kokoroVoiceId,
  onKokoroVoiceChange,
  webSpeechVoices = [],
  webSpeechVoiceURI,
  onWebSpeechVoiceChange,
  disabled,
}) {
  const naturalEnabled = naturalAvailable === true
  const instantEnabled = webSpeechSupported && (instantUsable || !instantVoicesReady)
  const instantTitle = !webSpeechSupported
    ? "Your browser doesn't support built-in speech"
    : !instantVoicesReady
      ? instantEmptyHint
      : instantUsable
        ? undefined
        : instantEmptyHint

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
          disabled={disabled || !naturalEnabled}
          title={!naturalEnabled ? naturalUnavailableHint : undefined}
        >
          Natural
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={engine === 'webspeech'}
          className={`jr-voice-engine-btn ${engine === 'webspeech' ? 'is-active' : ''}`}
          onClick={() => onEngineChange('webspeech')}
          disabled={disabled || !instantEnabled}
          title={instantTitle}
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
          <p className="jr-voice-empty">{instantEmptyHint}</p>
        )
      ) : naturalEnabled ? (
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
      ) : (
        <p className="jr-voice-empty">{naturalUnavailableHint}</p>
      )}
    </div>
  )
}
