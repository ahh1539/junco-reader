# Junco Reader

Free, private, fully client-side browser tool that narrates PDFs, TXT, Markdown, and pasted text with [Kokoro-82M](https://github.com/hexgrad/kokoro) via `kokoro-js`. Funnel companion to the [Junco](https://www.tryjunco.com) iOS newsletter podcast app.

**Production URL:** `https://read.tryjunco.com`

## Dev

```bash
npm install
npm run dev
```

## Model weights

By default the app downloads `onnx-community/Kokoro-82M-v1.0-ONNX` (q8) from Hugging Face on the user’s explicit “Download voice model” click. Transformers.js stores weights in the browser **Cache API** (`transformers-cache`) so revisits skip the network.

To serve from Junco’s CDN:

1. Mirror the HF repo to `https://models.tryjunco.com/kokoro-web/v1/onnx-community/Kokoro-82M-v1.0-ONNX/`
2. Allow CORS from `https://read.tryjunco.com` (and localhost for dev)
3. Build/deploy with `VITE_USE_CDN=true`

See [`public/model/manifest.json`](public/model/manifest.json).

## Deploy

Vercel project rooted at `junco-reader/`, domain `read.tryjunco.com`. Headers in `vercel.json` include COOP/`credentialless` COEP for WASM/WebGPU friendliness.

## Privacy

No accounts. Documents are parsed and synthesized only in the browser. The only network fetch after page load (besides fonts) is the voice model when the user opts in.
