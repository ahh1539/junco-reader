import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const resolve = (path) => fileURLToPath(new URL(path, import.meta.url))

/**
 * onnxruntime-web's default export inlines/emits a ~20–25 MB WASM file into
 * dist. Natural never uses a CPU model, and we point wasmPaths at jsDelivr
 * from the worker, so that origin copy would only cost Vercel bandwidth.
 * Dropping the emitted .wasm keeps it off the deploy; the worker JS is still
 * lazy (constructed only when the user downloads Natural).
 */
function omitOrtWasmFromOrigin() {
  return {
    name: 'omit-ort-wasm-from-origin',
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/\.wasm$/i.test(fileName) && /ort-wasm/i.test(fileName)) {
          delete bundle[fileName]
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), omitOrtWasmFromOrigin()],
  resolve: {
    // Official ORT export: JS only, WASM loaded via wasmPaths (jsDelivr).
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  optimizeDeps: {
    exclude: ['kokoro-js', '@huggingface/transformers', 'onnxruntime-web'],
  },
  worker: {
    format: 'es',
    resolve: {
      conditions: ['onnxruntime-web-use-extern-wasm'],
    },
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    rollupOptions: {
      // Static SEO/comparison pages, separate from the React app entry.
      input: {
        main: resolve('./index.html'),
        compareQuickTts: resolve('./compare/quick-tts/index.html'),
        compareKokoroweb: resolve('./compare/kokoroweb/index.html'),
        compareOfflineTts: resolve('./compare/offline-tts/index.html'),
      },
    },
  },
})
