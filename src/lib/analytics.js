import posthog from 'posthog-js'

const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com'

let started = false

/** Init once. Session replay off, anonymous, no autocapture (privacy). */
export function initAnalytics() {
  if (started || typeof window === 'undefined' || !KEY) return
  posthog.init(KEY, {
    api_host: HOST,
    person_profiles: 'identified_only',
    disable_session_recording: true,
    autocapture: false,
    capture_pageview: true,
    capture_pageleave: true,
  })
  posthog.register({
    surface: 'reader',
    environment: import.meta.env.PROD ? 'production' : 'development',
  })
  started = true
}

/** Privacy-safe funnel events — never include document text or filenames. */
export function track(event, data) {
  try {
    if (!started) initAnalytics()
    if (!KEY) return
    posthog.capture(event, data)
  } catch {
    /* ignore — analytics must never break the app */
  }
}

export const Events = {
  APP_STORE_CTA_CLICK: 'app_store_cta_click',
  LEARN_MORE_CLICK: 'learn_more_click',
  NUDGE_SHOWN: 'post_listen_nudge_shown',
  NUDGE_APP_STORE_CLICK: 'post_listen_nudge_app_store_click',
  NUDGE_DISMISS: 'post_listen_nudge_dismiss',
  MODEL_DOWNLOAD_START: 'model_download_start',
  FIRST_PLAY: 'first_play',
  AUDIO_DOWNLOAD: 'audio_download',
  TTS_FORMAT_TOGGLE: 'tts_format_toggle',
}
