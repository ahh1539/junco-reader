# Junco Reader

Free, private, fully client-side browser tool that narrates PDFs, DRM-free EPUBs, TXT, Markdown, and pasted text. Funnel companion to the [Junco](https://www.tryjunco.com) iOS newsletter podcast app.

**Production URL:** `https://read.tryjunco.com`

## Voice engines

Two tiers, both on-device:

- **Natural** (default) -- [Kokoro-82M](https://github.com/hexgrad/kokoro) via `kokoro-js`, the flagship voice quality and the same on-device model family as the iOS app. Needs a one-time model download (`ModelDownloadButton`) before playback.
- **Instant** (fallback) -- the browser's built-in Web Speech API. No download, works the moment a document loads, including on devices without WebGPU (e.g. iOS Safari). Switching engines is a toggle in `VoicePicker`; WAV export and generation stats are Kokoro-only (Web Speech exposes no raw PCM).

See `src/lib/kokoroEngine.js` / `kokoroWorkerClient.js` / `playbackPipeline.js` (Natural) and `src/lib/webSpeechEngine.js` (Instant).

## Dev

```bash
npm install
npm run dev
```

Optional analytics (same PostHog project as iOS). Create `.env`:

```bash
VITE_PUBLIC_POSTHOG_KEY=phc_…
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Without the key, the app runs normally and skips analytics.

## Model weights

By default the app downloads `onnx-community/Kokoro-82M-v1.0-ONNX` on the user’s explicit “Download voice model” click:

- **WebGPU browsers:** fp32 (~310 MB)  -  required for clean GPU audio and ~3-10× faster inference
- **WASM fallback:** q8 (~85 MB)

If Natural audio sounds distorted on a particular device, enable Compatibility mode beside the
model status. It forces the smaller client-side WASM/q8 path; the preference is stored only in
that browser, and the WebGPU and WASM model caches may coexist.

Transformers.js stores weights in the browser **Cache API** (`transformers-cache`) so revisits skip the network.

Synthesis runs in a Web Worker (off the audio-scheduling thread) and keeps ~30s of audio pre-synthesized ahead of playback. Chunks are scheduled on the `AudioContext` clock back-to-back (not triggered by `onended`), so seams are gapless regardless of main-thread load. A tiny warm-up runs after load, for the selected voice, to hide cold shader/WASM compile from the first Listen.

To serve from Junco’s CDN:

1. Mirror the HF repo to `https://models.tryjunco.com/kokoro-web/v1/onnx-community/Kokoro-82M-v1.0-ONNX/`
2. Allow CORS from `https://read.tryjunco.com` (and localhost for dev)
3. Build/deploy with `VITE_USE_CDN=true`

See [`public/model/manifest.json`](public/model/manifest.json).

## Deploy

Vercel project rooted at `junco-reader/`, domain `read.tryjunco.com`. Headers in `vercel.json` include COOP/`credentialless` COEP for WASM/WebGPU friendliness.

Set on the Vercel project:

- `VITE_PUBLIC_POSTHOG_KEY` — Junco PostHog project token (same as iOS)
- `VITE_PUBLIC_POSTHOG_HOST` — `https://us.i.posthog.com`

After deploy, disable **Vercel Analytics** on this project if it was enabled. Events are tagged `surface=reader` in PostHog (see `junco-landing/docs/geo-prompts.md`).

## PWA

Installable (`public/manifest.webmanifest` + `public/sw.js`). The service worker only registers in production builds (see `src/main.jsx`) to keep `npm run dev` free of caching surprises.

- **Offline app shell:** the entry HTML/JS/CSS/logo are precached on install; everything else same-origin is cache-first, populated as it's fetched. The Kokoro model itself lives in its own cache (`transformers-cache`, cross-origin) and is untouched by this.
- **File Handling:** installed, Junco Reader can be the OS "Open with" target for `.pdf`/`.epub`/`.txt`/`.md`/`.markdown` (`file_handlers` in the manifest, consumed via `window.launchQueue` in `App.jsx`).
- **Web Share Target:** on Android/Chrome, sharing a file (or text/URL) from another app's share sheet can target Junco Reader directly (`share_target` in the manifest). Since there's no backend, `sw.js` intercepts the POST, stages the payload in a dedicated Cache Storage bucket, and redirects to `/?shared=1`; `src/lib/incomingShare.js` picks it up on load.

Icons in `public/icons/` are derived from `public/junco-app-logo.webp` (see the maskable-icon padding note if regenerating).

## Comparisons

`compare/quick-tts/`, `compare/kokoroweb/`, `compare/offline-tts/` are static SEO pages (separate Vite build entries, see `vite.config.js` `build.rollupOptions.input`) comparing Junco Reader against other free browser-TTS tools. Share `src/styles/compare.css`, not the React app's CSS -- update facts there if a competitor's feature set changes.

## Privacy

No accounts. Documents are parsed and synthesized only in the browser. Optional network after page load (besides fonts): anonymous [PostHog](https://posthog.com) pageviews/events (no session replay, no autocapture, no document contents), and the voice model when the user opts in.

### EPUBs

EPUB 2/3 books are unpacked and read entirely on-device. Junco Reader supports DRM-free books only; it does not upload or retain the EPUB itself. For a previously opened book, it stores a byte-derived identifier plus the current chapter and character offset, so re-importing the same file can offer a local resume point. EPUB playback starts as soon as the first chunk is synthesized and continues chapter by chapter; it does not create a full-book audio download.

## SEO

- Canonical URL: `https://read.tryjunco.com/`
- `public/robots.txt` + `public/sitemap.xml` (home + the 3 comparison pages)
- Open Graph / Twitter / `WebApplication` JSON-LD in `index.html`; each comparison page has its own `WebPage` JSON-LD pointing back at it
- Static crawlable shell inside `#root` (replaced on React mount)
- Unknown paths return Vercel 404 (no SPA catch-all) so they are not soft-duplicates of `/`
- `public/llms.txt` for AI-crawler discovery, including the comparison pages

After deploy: submit `https://read.tryjunco.com/sitemap.xml` in Google Search Console (domain property `tryjunco.com`) and Bing Webmaster Tools (see `junco-landing/docs/geo-prompts.md`).
