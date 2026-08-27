import { useEffect } from 'react'

import { isWebMcpAvailable } from './webmcp.js'

/**
 * Load and register native WebMCP tools only when the browser exposes
 * `document.modelContext`. The tool catalog is a separate chunk so visitors
 * without the API never download it. No polyfill, no extra npm runtime.
 */
export function useWebMcpTools(actionsRef, { hasDocument = false, isEpub = false } = {}) {
  useEffect(() => {
    if (!isWebMcpAvailable()) return undefined

    let cancelled = false
    const controller = new AbortController()

    import('./webmcpTools.js')
      .then(({ connectWebMcpTools }) => {
        if (cancelled || controller.signal.aborted) return
        connectWebMcpTools(actionsRef, {
          hasDocument,
          isEpub,
          signal: controller.signal,
        })
      })
      .catch((err) => {
        if (!cancelled) console.warn('WebMCP: failed to load tools', err)
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [actionsRef, hasDocument, isEpub])
}
