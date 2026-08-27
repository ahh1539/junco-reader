import { SPEED_OPTIONS } from '../lib/playbackSpeeds'
import './SpeedControl.css'

export default function SpeedControl({ value, onChange, disabled }) {
  return (
    <label className="jr-speed">
      <span className="jr-speed-label">Speed</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="jr-speed-select"
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </label>
  )
}
