/**
 * Bundled sample so a first-time visitor can hear the product work before
 * they've got a document of their own to drop in.
 */
export const SAMPLE_DOCUMENT_NAME = 'Sample: how Junco Reader works'

export const SAMPLE_DOCUMENT_TEXT = `This is Junco Reader. Drop in a PDF, paste an article, or try this sample. Junco does not upload or persist document contents. Instant uses only voices the browser reports as local. Natural fetches its assets, then synthesizes client-side.

Natural is the default: a full-quality Kokoro model, about three hundred twenty-six megabytes, downloaded once when WebGPU is available. Instant uses a local browser voice when your system provides one.

Junco Reader is a free companion to Junco, an iPhone app that turns your email newsletters into a short daily podcast using these same on-device voices. If today's newsletters are still sitting unread, that might be worth a look.`

export function sampleDocument() {
  return { text: SAMPLE_DOCUMENT_TEXT, kind: 'txt', name: SAMPLE_DOCUMENT_NAME }
}
