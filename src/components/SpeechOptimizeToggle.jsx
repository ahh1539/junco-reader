import './SpeechOptimizeToggle.css'

export default function SpeechOptimizeToggle({
  checked,
  disabled = false,
  onChange,
}) {
  return (
    <label
      className={`jr-speech-toggle${disabled ? ' is-disabled' : ''}${checked ? ' is-on' : ''}`}
      title={
        disabled
          ? "Can't change while audio is playing"
          : 'Clean text so narration reads more naturally'
      }
    >
      <span className="jr-speech-toggle-label">Optimize for speech</span>
      <span className="jr-speech-toggle-track">
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          aria-label="Optimize for speech"
          onChange={(e) => onChange?.(e.target.checked)}
        />
        <span className="jr-speech-toggle-thumb" aria-hidden="true" />
      </span>
    </label>
  )
}
