import { afterEach, describe, expect, it, vi } from 'vitest'

import { hasSeenNudge, markNudgeSeen } from './postListenNudge.js'

afterEach(() => vi.unstubAllGlobals())

describe('post-listen nudge storage', () => {
  it('remembers the nudge without storing document information', () => {
    const values = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    })

    expect(hasSeenNudge()).toBe(false)
    markNudgeSeen()
    expect(hasSeenNudge()).toBe(true)
    expect([...values.keys()]).toEqual(['jr_nudge_seen_v1'])
  })

  it('degrades safely when browser storage is blocked', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('blocked') },
      setItem: () => { throw new Error('blocked') },
    })

    expect(hasSeenNudge()).toBe(false)
    expect(() => markNudgeSeen()).not.toThrow()
  })
})
