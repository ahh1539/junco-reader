import './SpeedControl.css'

/** Discrete presets only: each change cancels/reschedules one audio node. */
const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2]

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
