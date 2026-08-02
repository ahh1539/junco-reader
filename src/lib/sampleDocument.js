/**
 * Bundled sample so a first-time visitor can hear the product work before
 * they've got a document of their own to drop in.
 */
export const SAMPLE_DOCUMENT_NAME = 'Sample: how Junco Reader works'

export const SAMPLE_DOCUMENT_TEXT = `This is Junco Reader. Drop in a PDF, paste an article, or try this sample -- everything you hear is generated right here in your browser. Nothing you read is ever uploaded anywhere.

Two voices are on offer. This one is Natural, powered by Kokoro, an eighty-two million parameter model that runs entirely on your device after a one-time download. If you'd rather skip the download, switch to Instant in the voice picker -- that's your browser's built-in voice, no wait at all.

Junco Reader is a free companion to Junco, an iPhone app that turns your email newsletters into a short daily podcast using these same on-device voices. If today's newsletters are still sitting unread, that might be worth a look.`

export function sampleDocument() {
  return { text: SAMPLE_DOCUMENT_TEXT, kind: 'txt', name: SAMPLE_DOCUMENT_NAME }
}
