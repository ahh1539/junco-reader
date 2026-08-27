/**
 * Thin adapter around the WebMCP imperative API (`document.modelContext`).
 *
 * App.jsx names loaded-book state `document`, so this module always reads the
 * browsing document from `globalThis.document`, never from caller scope.
 *
 * Native-only: missing APIs no-op. Do not import @mcp-b/global or other
 * polyfills here — they add client bytes and optional extension bridges
 * without a Junco server. Spec: https://webmachinelearning.github.io/webmcp/
 */

export function getBrowsingDocument() {
  return typeof globalThis !== 'undefined' ? globalThis.document : null
}

export function getModelContext(root = getBrowsingDocument()) {
  if (root?.modelContext) return root.modelContext
  return globalThis.navigator?.modelContext || null
}

export function isWebMcpAvailable(root = getBrowsingDocument()) {
  const context = getModelContext(root)
  return typeof context?.registerTool === 'function'
}

export function toToolResult(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function toolOk(payload = {}) {
  return toToolResult({ ok: true, ...payload })
}

export function toolError(message) {
  return toToolResult({ ok: false, error: String(message || 'Tool failed.') })
}

function wrapExecute(execute) {
  return async (input, extras) => {
    try {
      const result = await execute(input ?? {}, extras ?? {})
      if (result == null) return toolOk()
      if (typeof result === 'string') return result
      if (typeof result === 'object' && result.ok === false) return toToolResult(result)
      if (typeof result === 'object' && result.ok === true) return toToolResult(result)
      return toolOk(result)
    } catch (err) {
      return toolError(err?.message || 'Tool failed.')
    }
  }
}

export function normalizeTool(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    annotations: tool.annotations,
    execute: wrapExecute(tool.execute),
  }
}

/**
 * Register tools and return a disposer that aborts them (WebMCP has no
 * unregisterTool; lifecycle is AbortSignal-only).
 *
 * @param {object[]} tools
 * @param {{ context?: object, signal?: AbortSignal }} [options]
 * @returns {Promise<() => void>}
 */
export async function registerTools(tools, { context, signal } = {}) {
  const mc = context ?? getModelContext()
  if (typeof mc?.registerTool !== 'function') return () => {}

  const controller = new AbortController()
  const abort = () => {
    if (!controller.signal.aborted) controller.abort()
  }

  if (signal) {
    if (signal.aborted) return () => {}
    signal.addEventListener('abort', abort, { once: true })
  }

  await Promise.all(
    (tools || []).map(async (tool) => {
      if (controller.signal.aborted) return
      try {
        await Promise.resolve(
          mc.registerTool(normalizeTool(tool), { signal: controller.signal }),
        )
      } catch (err) {
        if (controller.signal.aborted) return
        console.warn(`WebMCP: failed to register tool "${tool?.name}"`, err)
      }
    }),
  )

  return abort
}
