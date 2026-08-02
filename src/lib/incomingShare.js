/**
 * Reads whatever the OS share sheet staged for this load via the Web Share
 * Target (public/sw.js handles the POST; there's no server, so the payload
 * is stashed in a dedicated Cache Storage bucket and picked up here once,
 * right after the redirect to /?shared=1).
 */

const SHARE_CACHE = 'junco-reader-share-v1'

function fileNameFromResponse(response) {
  const raw = response.headers.get('X-Shared-Filename')
  if (!raw) return 'shared-file'
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** @returns {Promise<File | null>} */
export async function takeSharedFile() {
  if (typeof window === 'undefined' || !('caches' in window)) return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    const response = await cache.match('/__share/file')
    if (!response) return null
    await cache.delete('/__share/file')
    const blob = await response.blob()
    return new File([blob], fileNameFromResponse(response), { type: blob.type })
  } catch {
    return null
  }
}

/** @returns {Promise<{ text: string, url: string, title: string } | null>} */
export async function takeSharedText() {
  if (typeof window === 'undefined' || !('caches' in window)) return null
  try {
    const cache = await caches.open(SHARE_CACHE)
    const response = await cache.match('/__share/text')
    if (!response) return null
    await cache.delete('/__share/text')
    return await response.json()
  } catch {
    return null
  }
}

export function hasIncomingShareParam() {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('shared') === '1'
}

/** Drop the ?shared=1 marker so a manual reload doesn't re-trigger the check. */
export function clearShareParamFromUrl() {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.delete('shared')
  window.history.replaceState({}, '', url.pathname + url.search + url.hash)
}
