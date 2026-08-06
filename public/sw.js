/**
 * Minimal service worker: installability + a small offline app shell, plus
 * the receiving end of the Web Share Target (share_target in
 * manifest.webmanifest). The shell (entry HTML/JS/CSS/logo) is precached on
 * install; everything else same-origin is cache-first, populated as it's
 * fetched. The Kokoro model weights live in their own cache (see
 * src/lib/modelCache.js, TRANSFORMERS_CACHE) and are cross-origin, so they
 * never touch this one.
 */

// Bump when a release changes the app shell so installed PWAs fetch the new
// input support instead of continuing to serve a previously cached entry.
const SHELL_CACHE = 'junco-reader-shell-v2'
const SHARE_CACHE = 'junco-reader-share-v1'

/**
 * Precache just the entry HTML + its directly-referenced JS/CSS -- the part
 * of the app that renders the UI and runs Web Speech / pasted-text reading
 * offline. Deliberately excludes the code-split PDF/Kokoro/ONNX-WASM chunks
 * (tens of MB, lazily `import()`-ed only when a document or the neural
 * voice is actually used): those pick up runtime caching below the first
 * time they're fetched, instead of bloating every first-time install.
 * Without this, a reload immediately after the SW's first install would
 * still miss the shell -- a service worker never controls the very page
 * load that registered it, so nothing would've passed through the runtime
 * cache-on-fetch path below yet.
 */
// Rendered client-side (the nav logo/favicon), so it never appears in the
// static HTML the regex below scans -- listed explicitly instead.
const ALWAYS_PRECACHE = ['/junco-app-logo.webp']

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const shellResponse = await fetch('/', { cache: 'no-cache' })
    if (!shellResponse.ok) return
    const html = await shellResponse.clone().text()
    await cache.put('/', shellResponse)

    const assetUrls = new Set(ALWAYS_PRECACHE)
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)) {
      assetUrls.add(match[1])
    }
    await Promise.all(
      [...assetUrls].map(async (url) => {
        try {
          const res = await fetch(url)
          if (res.ok) await cache.put(url, res)
        } catch {
          /* best-effort; runtime caching still covers it on next visit */
        }
      }),
    )
  } catch {
    /* best-effort -- offline just isn't available until the next online visit */
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('junco-reader-shell-') && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

/**
 * Web Share Target endpoint. The OS share sheet POSTs here (files and/or
 * text/url) after the user picks Junco Reader; there's no server, so the
 * shared payload is stashed in a dedicated cache for the page to pick up
 * right after the redirect, then it's consumed and deleted.
 */
async function handleShareTarget(request) {
  const cache = await caches.open(SHARE_CACHE)
  try {
    const formData = await request.formData()
    const file = formData.get('shared_file')
    const text = formData.get('text') || ''
    const title = formData.get('title') || ''
    const url = formData.get('url') || ''

    if (file && typeof file === 'object' && file.size > 0) {
      await cache.put(
        '/__share/file',
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Shared-Filename': encodeURIComponent(file.name || 'shared-file'),
          },
        }),
      )
    } else if (text || url) {
      await cache.put(
        '/__share/text',
        new Response(JSON.stringify({ text, url, title }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }
  } catch {
    // Best-effort -- fall through to the redirect regardless, the app just
    // won't find anything staged and behaves like a normal cold load.
  }
  return Response.redirect('/?shared=1', 303)
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method === 'POST' && url.pathname === '/share-target/') {
    event.respondWith(handleShareTarget(request))
    return
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  // Never intercept the share-payload cache reads (used by the page itself).
  if (url.pathname.startsWith('/__share/')) return

  // Match/store by URL string, not the live Request object: Vite's built
  // index.html marks its entry script/stylesheet `crossorigin`, which flips
  // their fetch mode/credentials -- Cache Storage keys on the full Request
  // in a way that a same-URL-but-different-mode Request can miss. Precached
  // entries were written from plain string URLs (see precacheShell above),
  // so matching by string here keeps both sides consistent regardless of
  // how the browser happened to construct this particular request.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      const cached = await cache.match(request.url, { ignoreVary: true })
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) cache.put(request.url, response.clone())
      return response
    })(),
  )
})
