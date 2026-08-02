import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initAnalytics } from './lib/analytics'

initAnalytics()

// Production only -- a dev-mode SW would cache Vite's HMR/module requests
// and make local iteration confusing.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* installability degrades gracefully without it */
    })
  })
}

const rootEl = document.getElementById('root')
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

requestAnimationFrame(() => {
  rootEl?.setAttribute('data-ready', '')
})
