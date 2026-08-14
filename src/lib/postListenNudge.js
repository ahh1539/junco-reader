const NUDGE_KEY = 'jr_nudge_seen_v1'

export function hasSeenNudge() {
  try {
    return localStorage.getItem(NUDGE_KEY) === '1'
  } catch {
    return false
  }
}

export function markNudgeSeen() {
  try {
    localStorage.setItem(NUDGE_KEY, '1')
  } catch {
    /* Storage is optional; the nudge may appear again without it. */
  }
}
