import { describe, expect, it } from 'vitest'

import {
  isGlobalPlaybackShortcut,
  shouldApplyNaturalProbe,
  shouldApplyVoiceProbe,
  shouldStartNaturalPipeline,
} from './playbackGuard.js'

describe('isGlobalPlaybackShortcut', () => {
  it('accepts unhandled Space and media keys outside controls', () => {
    const target = { closest: () => null }
    expect(isGlobalPlaybackShortcut({ code: 'Space', key: ' ', target })).toBe(true)
    expect(isGlobalPlaybackShortcut({ key: 'MediaPlayPause', target })).toBe(true)
  })

  it('ignores handled events and interactive role controls', () => {
    expect(
      isGlobalPlaybackShortcut({
        code: 'Space',
        key: ' ',
        defaultPrevented: true,
        target: { closest: () => null },
      }),
    ).toBe(false)
    expect(
      isGlobalPlaybackShortcut({
        code: 'Space',
        key: ' ',
        target: { closest: () => ({ role: 'button' }) },
      }),
    ).toBe(false)
  })
})

describe('shouldStartNaturalPipeline', () => {
  it('allows the active, not-stopped run', () => {
    expect(
      shouldStartNaturalPipeline({ playbackRun: 3, currentRun: 3, stopped: false }),
    ).toBe(true)
  })

  it('blocks after stop, engine switch, a newer run token, or UI pause during setup', () => {
    expect(
      shouldStartNaturalPipeline({ playbackRun: 3, currentRun: 3, stopped: true }),
    ).toBe(false)
    expect(
      shouldStartNaturalPipeline({ playbackRun: 3, currentRun: 4, stopped: false }),
    ).toBe(false)
    expect(
      shouldStartNaturalPipeline({ playbackRun: 3, currentRun: 4, stopped: true }),
    ).toBe(false)
    expect(
      shouldStartNaturalPipeline({ playbackRun: 3, currentRun: 3, stopped: false, paused: true }),
    ).toBe(false)
  })

  it('does not start the pipeline while the UI is paused', () => {
    expect(
      shouldStartNaturalPipeline({ playbackRun: 1, currentRun: 1, stopped: false, paused: true }),
    ).toBe(false)
    expect(
      shouldStartNaturalPipeline({ playbackRun: 1, currentRun: 1, stopped: false, paused: false }),
    ).toBe(true)
  })
})

describe('capability probe writes', () => {
  it('applies Instant voice results unless the probe was cancelled or superseded', () => {
    expect(
      shouldApplyVoiceProbe({ cancelled: false, probeGeneration: 1, currentProbeGeneration: 1 }),
    ).toBe(true)
    expect(
      shouldApplyVoiceProbe({ cancelled: true, probeGeneration: 1, currentProbeGeneration: 1 }),
    ).toBe(false)
    expect(
      shouldApplyVoiceProbe({ cancelled: false, probeGeneration: 1, currentProbeGeneration: 2 }),
    ).toBe(false)
  })

  it('does not let a stale probe overwrite a user-started Natural load', () => {
    expect(
      shouldApplyNaturalProbe({
        cancelled: false,
        probeGeneration: 1,
        currentProbeGeneration: 1,
        runtimeVersion: 0,
        currentRuntimeVersion: 0,
        modelLoadStarted: true,
      }),
    ).toBe(false)
  })

  it('does not apply Natural probe results after a newer runtime generation', () => {
    expect(
      shouldApplyNaturalProbe({
        cancelled: false,
        probeGeneration: 1,
        currentProbeGeneration: 1,
        runtimeVersion: 0,
        currentRuntimeVersion: 1,
        modelLoadStarted: false,
      }),
    ).toBe(false)
  })

  it('applies Natural probe results when still the current idle probe', () => {
    expect(
      shouldApplyNaturalProbe({
        cancelled: false,
        probeGeneration: 2,
        currentProbeGeneration: 2,
        runtimeVersion: 1,
        currentRuntimeVersion: 1,
        modelLoadStarted: false,
      }),
    ).toBe(true)
  })
})
