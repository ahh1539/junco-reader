import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const resolve = (path) => fileURLToPath(new URL(path, import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['kokoro-js'],
  },
  worker: {
    format: 'es',
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
