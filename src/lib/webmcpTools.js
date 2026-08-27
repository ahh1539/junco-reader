import { SPEED_OPTIONS } from './playbackSpeeds.js'
import { epubChapterListing } from './webmcpListing.js'
import { registerTools } from './webmcp.js'
import { VOICES } from './voices.js'

const EMPTY_INPUT = { type: 'object', properties: {} }

const READ_ONLY = { readOnlyHint: true, untrustedContentHint: false }
const MUTATING = { readOnlyHint: false, untrustedContentHint: false }
const UNTRUSTED_INPUT = { readOnlyHint: false, untrustedContentHint: true }

function callAction(actionsRef, name, ...args) {
  const action = actionsRef?.current?.[name]
  if (typeof action !== 'function') {
    throw new Error(`Reader action "${name}" is not available.`)
  }
  return action(...args)
}

const NATURAL_VOICE_NAMES = VOICES.map((voice) => `${voice.displayName} (${voice.id})`).join(', ')

function alwaysTools(actionsRef) {
  return [
    {
      name: 'get_reader_status',
      title: 'Reader status',
      description:
        'Read the current Junco Reader state: whether a document is open, voice engine, playback, speed, and EPUB chapter position. Returns metadata only, never document text.',
      inputSchema: EMPTY_INPUT,
      annotations: READ_ONLY,
      execute: () => callAction(actionsRef, 'getStatus'),
    },
    {
      name: 'load_sample_document',
      title: 'Load sample document',
      description:
        'Open the built-in sample document so the user can hear Junco Reader without providing their own file or text.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'loadSample'),
    },
    {
      name: 'open_pasted_text',
      title: 'Open pasted text',
      description:
        'Open pasted plain text or Markdown in Junco Reader for narration. Use this when the user provides article or document text. Does not return the document body.',
      inputSchema: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The full text or Markdown to narrate.',
          },
        },
        required: ['text'],
      },
      annotations: UNTRUSTED_INPUT,
      execute: ({ text }) => callAction(actionsRef, 'openPastedText', text),
    },
    {
      name: 'set_engine',
      title: 'Set voice engine',
      description:
        'Switch the voice engine between Natural (on-device Kokoro) and Instant (local browser speech).',
      inputSchema: {
        type: 'object',
        properties: {
          engine: {
            type: 'string',
            enum: ['natural', 'instant'],
            description: 'natural is Kokoro WebGPU; instant is the browser Web Speech API.',
          },
        },
        required: ['engine'],
      },
      annotations: MUTATING,
      execute: ({ engine }) => callAction(actionsRef, 'setEngine', engine),
    },
    {
      name: 'set_voice',
      title: 'Set voice',
      description:
        `Choose the active voice. For Natural, use a voice id such as ${NATURAL_VOICE_NAMES}. For Instant, use a local browser voice name or voiceURI from get_reader_status.`,
      inputSchema: {
        type: 'object',
        properties: {
          voice: {
            type: 'string',
            description: 'Natural voice id or display name, or Instant voiceURI / name.',
          },
        },
        required: ['voice'],
      },
      annotations: MUTATING,
      execute: ({ voice }) => callAction(actionsRef, 'setVoice', voice),
    },
    {
      name: 'set_speed',
      title: 'Set playback speed',
      description: 'Set narration speed to one of the discrete player presets.',
      inputSchema: {
        type: 'object',
        properties: {
          speed: {
            type: 'number',
            enum: SPEED_OPTIONS,
            description: 'Playback rate multiplier.',
          },
        },
        required: ['speed'],
      },
      annotations: MUTATING,
      execute: ({ speed }) => callAction(actionsRef, 'setSpeed', speed),
    },
    {
      name: 'download_natural_model',
      title: 'Download Natural voice',
      description:
        'Download the on-device Natural (Kokoro) voice model into this browser when the user wants Natural speech. About 326 MB, fetched from Hugging Face. Skips the download when the model is already ready.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'downloadNaturalModel'),
    },
    {
      name: 'clear_natural_model',
      title: 'Remove Natural voice',
      description:
        'Remove the cached Natural voice model from this device. The user is asked to confirm. Documents are not stored and are not affected.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'clearNaturalModel'),
    },
  ]
}

function documentTools(actionsRef) {
  return [
    {
      name: 'play',
      title: 'Play',
      description:
        'Start listening to the open document, or resume if playback is paused. Uses the current engine, voice, speed, and EPUB resume or chapter target.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'play'),
    },
    {
      name: 'pause',
      title: 'Pause',
      description: 'Pause narration while keeping the current place.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'pause'),
    },
    {
      name: 'stop',
      title: 'Stop',
      description: 'Stop narration and reset the current playback session.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'stop'),
    },
  ]
}

function epubTools(actionsRef) {
  return [
    {
      name: 'list_chapters',
      title: 'List chapters',
      description:
        'List EPUB chapter titles and section titles for the open book. Returns titles and indices only, never chapter body text.',
      inputSchema: EMPTY_INPUT,
      annotations: READ_ONLY,
      execute: () => callAction(actionsRef, 'listChapters'),
    },
    {
      name: 'seek_chapter',
      title: 'Seek chapter',
      description:
        'Move to a chapter in the open EPUB. By default this sets a Play-from-here target without interrupting current narration. Set play_now to start listening at that chapter.',
      inputSchema: {
        type: 'object',
        properties: {
          chapter: {
            type: 'integer',
            minimum: 1,
            description: '1-based chapter number from list_chapters.',
          },
          play_now: {
            type: 'boolean',
            description: 'If true, start listening at the chapter immediately.',
          },
        },
        required: ['chapter'],
      },
      annotations: MUTATING,
      execute: ({ chapter, play_now: playNow }) =>
        callAction(actionsRef, 'seekChapter', { chapter, playNow: Boolean(playNow) }),
    },
    {
      name: 'play_from_section',
      title: 'Play from section',
      description:
        'Start listening from a chapter section in the open EPUB. Identify the section with section_id from list_chapters, or with a section title.',
      inputSchema: {
        type: 'object',
        properties: {
          chapter: {
            type: 'integer',
            minimum: 1,
            description: '1-based chapter number from list_chapters.',
          },
          section_id: {
            type: 'string',
            description: 'Section id from list_chapters.',
          },
          section_title: {
            type: 'string',
            description: 'Section title to match when section_id is not known.',
          },
        },
        required: ['chapter'],
      },
      annotations: MUTATING,
      execute: ({ chapter, section_id: sectionId, section_title: sectionTitle }) =>
        callAction(actionsRef, 'playFromSection', { chapter, sectionId, sectionTitle }),
    },
    {
      name: 'resume_saved_position',
      title: 'Resume saved position',
      description:
        'Resume listening from the locally saved EPUB position for this book (chapter and character offset stored in the browser).',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'resumeSaved'),
    },
    {
      name: 'clear_saved_position',
      title: 'Clear saved position',
      description:
        'Forget the locally saved EPUB resume point for the open book. Does not upload anything and does not stop playback.',
      inputSchema: EMPTY_INPUT,
      annotations: MUTATING,
      execute: () => callAction(actionsRef, 'clearSaved'),
    },
  ]
}

export { epubChapterListing }

export function buildWebMcpTools(actionsRef) {
  return {
    always: alwaysTools(actionsRef),
    whenDocumentLoaded: documentTools(actionsRef),
    whenEpub: epubTools(actionsRef),
  }
}

export function webMcpToolNames(groups = buildWebMcpTools({ current: {} })) {
  return {
    always: groups.always.map((tool) => tool.name),
    whenDocumentLoaded: groups.whenDocumentLoaded.map((tool) => tool.name),
    whenEpub: groups.whenEpub.map((tool) => tool.name),
  }
}

/**
 * Register the current tool set. Abort `signal` (or the returned disposer)
 * to unregister. Native `document.modelContext` only — no polyfill.
 */
export function connectWebMcpTools(
  actionsRef,
  { hasDocument = false, isEpub = false, signal, context } = {},
) {
  const groups = buildWebMcpTools(actionsRef)
  const tools = [
    ...groups.always,
    ...(hasDocument ? groups.whenDocumentLoaded : []),
    ...(isEpub ? groups.whenEpub : []),
  ]
  const controller = new AbortController()
  if (signal) {
    if (signal.aborted) return () => {}
    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  void registerTools(tools, { context, signal: controller.signal })
  return () => {
    if (!controller.signal.aborted) controller.abort()
  }
}


