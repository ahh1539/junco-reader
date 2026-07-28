# Junco Reader

Free, private, fully client-side browser tool that narrates PDFs, TXT, Markdown, and pasted text with [Kokoro-82M](https://github.com/hexgrad/kokoro) via `kokoro-js`. Funnel companion to the [Junco](https://www.tryjunco.com) iOS newsletter podcast app.

**Production URL:** `https://read.tryjunco.com`

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

## Privacy

No accounts. Documents are parsed and synthesized only in the browser. Optional network after page load (besides fonts): anonymous [PostHog](https://posthog.com) pageviews/events (no session replay, no autocapture, no document contents), and the voice model when the user opts in.

## SEO

- Canonical URL: `https://read.tryjunco.com/`
- `public/robots.txt` + `public/sitemap.xml` (single URL)
- Open Graph / Twitter / `WebApplication` JSON-LD in `index.html`
- Static crawlable shell inside `#root` (replaced on React mount)
- Unknown paths return Vercel 404 (no SPA catch-all) so they are not soft-duplicates of `/`

After deploy: submit `https://read.tryjunco.com/sitemap.xml` in Google Search Console (domain property `tryjunco.com`) and Bing Webmaster Tools (see `junco-landing/docs/geo-prompts.md`).
