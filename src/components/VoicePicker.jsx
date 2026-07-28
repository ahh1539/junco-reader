import { VOICES } from '../lib/voices'
import './VoicePicker.css'

export default function VoicePicker({ value, onChange, disabled }) {
  return (
    <label className="jr-voice">
      <span className="jr-voice-label">Voice</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="jr-voice-select"
      >
        {VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.displayName}
            {v.note ? ` (${v.note})` : ''} / {v.accent} {v.gender}
          </option>
        ))}
      </select>
    </label>
  )
}
