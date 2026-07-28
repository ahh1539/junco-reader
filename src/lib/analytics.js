import { track as vercelTrack } from '@vercel/analytics'

/** Privacy-safe funnel events — never include document text or filenames. */
export function track(event, data) {
  try {
    vercelTrack(event, data)
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
}
