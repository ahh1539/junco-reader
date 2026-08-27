/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getModelContext,
  isWebMcpAvailable,
  normalizeTool,
  registerTools,
  toToolResult,
  toolError,
  toolOk,
} from './webmcp.js'

function mockModelContext() {
  const registered = new Map()
  return {
    registered,
    registerTool: vi.fn(async (tool, { signal } = {}) => {
      if (!tool?.name) throw new Error('missing name')
      if (registered.has(tool.name)) throw new Error('duplicate')
      registered.set(tool.name, tool)
      signal?.addEventListener(
        'abort',
        () => {
          registered.delete(tool.name)
        },
        { once: true },
      )
    }),
  }
}

afterEach(() => {
  if (typeof document !== 'undefined') {
    try {
      delete document.modelContext
    } catch {
      document.modelContext = undefined
    }
  }
  try {
    delete navigator.modelContext
  } catch {
    /* some runtimes expose a getter-only navigator */
  }
})

describe('isWebMcpAvailable', () => {
  it('is false without modelContext', () => {
    expect(isWebMcpAvailable()).toBe(false)
  })

  it('is true when document.modelContext.registerTool exists', () => {
    document.modelContext = mockModelContext()
    expect(isWebMcpAvailable()).toBe(true)
  })
})

describe('getModelContext', () => {
  it('prefers document.modelContext over navigator.modelContext', () => {
    const docContext = mockModelContext()
    document.modelContext = docContext
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: mockModelContext(),
    })
    expect(getModelContext()).toBe(docContext)
  })

  it('falls back to navigator.modelContext', () => {
    const navContext = mockModelContext()
    Object.defineProperty(navigator, 'modelContext', {
      configurable: true,
      value: navContext,
    })
    expect(getModelContext()).toBe(navContext)
  })
})

describe('tool results', () => {
  it('serializes objects and passes strings through', () => {
    expect(toToolResult('already')).toBe('already')
    expect(JSON.parse(toolOk({ speed: 1 }))).toEqual({ ok: true, speed: 1 })
    expect(JSON.parse(toolError('nope'))).toEqual({ ok: false, error: 'nope' })
  })
})

describe('registerTools', () => {
  it('no-ops without a modelContext', async () => {
    const abort = await registerTools([{ name: 'x', description: 'x', execute: () => {} }])
    expect(typeof abort).toBe('function')
    expect(() => abort()).not.toThrow()
  })

  it('registers tools and unregisters them when aborted', async () => {
    const context = mockModelContext()
    const abort = await registerTools(
      [
        {
          name: 'ping',
          description: 'Ping',
          execute: () => ({ pong: true }),
        },
      ],
      { context },
    )

    expect(context.registerTool).toHaveBeenCalledOnce()
    expect(context.registered.has('ping')).toBe(true)

    abort()
    expect(context.registered.has('ping')).toBe(false)
  })

  it('aborts registration when the parent signal is aborted', async () => {
    const context = mockModelContext()
    const controller = new AbortController()
    await registerTools(
      [{ name: 'ping', description: 'Ping', execute: () => 'ok' }],
      { context, signal: controller.signal },
    )
    expect(context.registered.has('ping')).toBe(true)
    controller.abort()
    expect(context.registered.has('ping')).toBe(false)
  })

  it('skips registration when the parent signal is already aborted', async () => {
    const context = mockModelContext()
    const controller = new AbortController()
    controller.abort()
    await registerTools(
      [{ name: 'ping', description: 'Ping', execute: () => 'ok' }],
      { context, signal: controller.signal },
    )
    expect(context.registerTool).not.toHaveBeenCalled()
  })

  it('swallows duplicate-registration errors instead of throwing', async () => {
    const context = mockModelContext()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await registerTools(
      [
        { name: 'ping', description: 'Ping', execute: () => 'ok' },
        { name: 'ping', description: 'Ping again', execute: () => 'ok' },
      ],
      { context },
    )
    expect(context.registered.size).toBe(1)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('normalizeTool', () => {
  it('wraps execute so objects become JSON and thrown errors become tool errors', async () => {
    const ok = normalizeTool({
      name: 'ok',
      description: 'ok',
      execute: () => ({ chapter: 1 }),
    })
    expect(JSON.parse(await ok.execute({}))).toEqual({ ok: true, chapter: 1 })

    const fail = normalizeTool({
      name: 'fail',
      description: 'fail',
      execute: () => {
        throw new Error('missing document')
      },
    })
    expect(JSON.parse(await fail.execute({}))).toEqual({
      ok: false,
      error: 'missing document',
    })
  })
})
