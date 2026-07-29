import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { initAnalytics } from './lib/analytics'

initAnalytics()

const rootEl = document.getElementById('root')
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

requestAnimationFrame(() => {
  rootEl?.setAttribute('data-ready', '')
})
