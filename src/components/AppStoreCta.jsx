import { APP_STORE_URL, MARKETING_URL } from '../lib/appStore'
import './AppStoreCta.css'

export default function AppStoreCta() {
  return (
    <aside className="jr-cta" aria-label="Junco app">
      <p className="jr-cta-copy">
        Want this for your newsletters every morning?{' '}
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
          Get Junco on iPhone
        </a>
        <span className="jr-cta-sep">·</span>
        <a href={MARKETING_URL} target="_blank" rel="noopener noreferrer">
          Learn more
        </a>
      </p>
    </aside>
  )
}
