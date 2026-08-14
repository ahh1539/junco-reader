/**
 * Playback / probe guards. Kept as plain helpers so cancellation races can be
 * unit-tested without mounting the React app.
 */

/** True only while this Natural listen is still the active, unpaused run. */
export function shouldStartNaturalPipeline({ playbackRun, currentRun, stopped, paused = false }) {
  return !stopped && !paused && playbackRun === currentRun
}

/** Keep global media shortcuts away from controls and already-handled events. */
export function isGlobalPlaybackShortcut(event) {
  if (event?.defaultPrevented) return false
  if (
    event?.target?.closest?.(
      'input, textarea, select, button, a, [role="button"], [contenteditable="true"]',
    )
  ) {
    return false
  }
  return event?.code === 'Space' || event?.key === ' ' || event?.key === 'MediaPlayPause'
}

/**
 * Independent probe results (capability copy, Instant voices) may apply even
 * if the user already started a Natural download. They must not apply after
 * unmount or a newer probe.
 */
export function shouldApplyVoiceProbe({ cancelled, probeGeneration, currentProbeGeneration }) {
  return !cancelled && probeGeneration === currentProbeGeneration
}

/**
 * Natural availability, engine, and model-status writes from the mount probe.
 * A user-started download/load or a newer probe/runtime generation owns that
 * state instead.
 */
export function shouldApplyNaturalProbe({
  cancelled,
  probeGeneration,
  currentProbeGeneration,
  runtimeVersion,
  currentRuntimeVersion,
  modelLoadStarted,
}) {
  return (
    shouldApplyVoiceProbe({ cancelled, probeGeneration, currentProbeGeneration }) &&
    runtimeVersion === currentRuntimeVersion &&
    !modelLoadStarted
  )
}
