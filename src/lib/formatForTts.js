/**
 * Deterministic, client-side text cleanup for Kokoro TTS.
 *
 * Pure sync function: same input → same output. No network, no LLM, no randomness.
 *
 * Intentionally does NOT re-expand titles/years/currency that kokoro-js
 * `normalize_text` already handles (Dr./Mr./Ms./Mrs., years, $ / £, times).
 * Focuses on document junk that would otherwise be spoken badly.
 */

/** Soft hyphen / zero-width noise from PDF extraction (ZWJ handled with emoji pass). */
const INVISIBLE_RE = /[\u00AD\u200B\u200C\uFEFF]/g

/** Markdown IPA override: [word](/ipa/) — must not be stripped as a citation. */
const IPA_OVERRIDE_RE = /\[[^\]]+\]\(\/[^)]+\/\)/g

const IPA_SLOT_PREFIX = '<<<IPA'
const IPA_SLOT_SUFFIX = '>>>'
const IPA_SLOT_RESTORE_RE = /<<<IPA(\d+)>>>/g

/** Numeric / short citation brackets like [1], [12, 15], [see 3]. */
const CITATION_BRACKET_RE =
  /\s*\[\s*(?:(?:see|cf|ref|refs|e\.g)\.?,?\s*)?\d+(?:\s*[\s,;–-]\s*\d+)*\s*\]/gi

/** Superscript-style footnote markers. */
const FOOTNOTE_MARK_RE = /[¹²³⁴⁵⁶⁷⁸⁹⁰\u2020\u2021]+/g

/** Bare URL. */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()[\]{}'"]+/gi

/** Email. */
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi

/** Standalone page-number lines (digits / "Page N" — not loose roman, which false-positives words). */
const PAGE_LINE_RE =
  /(?:^|\n)\s*(?:-?\s*\d+\s*-?|(?:Page|Pg\.?)\s+\d+(?:\s+of\s+\d+)?)\s*(?=\n|$)/gi

/** Box-drawing / table separators that survive PDF extract. */
const BOX_DRAW_RE = /[│┃┆┊║╒╓╔╕╖╗╘╙╚╛╜╝╞╟╠╡╢╣╤╥╦╧╨╩╪╫╬─━┄┅┈┉═|]+/g

/** Fake emotion / stage tags like [excited] — not IPA overrides. */
const FAKE_TAG_RE = /\[(?:excited|happy|sad|angry|whisper|loud|soft|pause)\]/gi

/** Clear phone patterns. */
const PHONE_RE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g

/**
 * Strip emoji / pictographs without putting combining marks in a character class.
 * @param {string} text
 */
function stripEmoji(text) {
  return Array.from(text)
    .filter((ch) => {
      const cp = ch.codePointAt(0)
      if (cp >= 0x1f300 && cp <= 0x1faff) return false // misc symbols & pictographs / emoticons / etc.
      if (cp >= 0x1f1e6 && cp <= 0x1f1ff) return false // regional indicators (flag emoji)
      if (cp >= 0x2600 && cp <= 0x27bf) return false // misc symbols / dingbats
      if (cp === 0xfe0f || cp === 0x200d || cp === 0x20e3) return false // VS16, ZWJ, keycap
      return true
    })
    .join('')
}

/**
 * @param {string} raw
 * @returns {string}
 */
export function formatForTts(raw) {
  let text = String(raw || '')
  if (!text) return ''

  // Protect IPA overrides while stripping citation brackets.
  const ipaSlots = []
  text = text.replace(IPA_OVERRIDE_RE, (match) => {
    const i = ipaSlots.length
    ipaSlots.push(match)
    return `${IPA_SLOT_PREFIX}${i}${IPA_SLOT_SUFFIX}`
  })

  // PDF soft hyphens / zero-width chars, then rejoin hyphenated line breaks.
  text = text.replace(INVISIBLE_RE, '')
  text = text.replace(/(\w)-\n(\w)/g, '$1$2')

  text = stripEmoji(text)
  text = text.replace(FAKE_TAG_RE, '')
  text = text.replace(FOOTNOTE_MARK_RE, '')
  text = text.replace(CITATION_BRACKET_RE, '')
  text = text.replace(PAGE_LINE_RE, '\n')
  text = text.replace(BOX_DRAW_RE, ' ')

  text = text.replace(URL_RE, (url) => speakUrl(url))
  text = text.replace(EMAIL_RE, (email) => speakEmail(email))
  text = text.replace(PHONE_RE, (phone) => speakPhone(phone))

  // Abbreviations kokoro-js normalize_text does not cover.
  text = text
    .replace(/\bProf\.(?=\s)/g, 'Professor')
    .replace(/\bvs\./gi, 'versus')
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\bapprox\./gi, 'approximately')

  // Light symbol speech.
  text = text
    .replace(/%/g, ' percent')
    .replace(/&/g, ' and ')
    .replace(/[→⇒➞]/g, ' to ')
    .replace(/#(\w+)/g, '$1')

  // Prosody hygiene — punctuation is Kokoro's main control surface.
  text = text
    .replace(/[—–]/g, ' - ')
    .replace(/…/g, '...')
    .replace(/!{2,}/g, '!')
    .replace(/\?{2,}/g, '?')
    .replace(/\.{4,}/g, '...')
    // Preserve paragraph breaks as sentence boundaries before whitespace flatten.
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ' ')

  // Restore IPA overrides.
  text = text.replace(IPA_SLOT_RESTORE_RE, (_, i) => ipaSlots[Number(i)] ?? '')

  // Collapse whitespace / orphaned punctuation left by stripping.
  text = text
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([([{\u00AB])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/\s+([)\u00BB}\]])/g, '$1')
    .replace(/\.\s*\./g, '.')
    .trim()

  return text
}

/**
 * @param {string} url
 * @returns {string}
 */
function speakUrl(url) {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`
    const host = new URL(withProto).hostname.replace(/^www\./i, '')
    return host || 'link'
  } catch {
    return 'link'
  }
}

/**
 * @param {string} email
 * @returns {string}
 */
function speakEmail(email) {
  const [user, domain] = email.split('@')
  if (!domain) return email.replace(/@/g, ' at ')
  return `${user} at ${domain.replace(/\./g, ' dot ')}`
}

/**
 * @param {string} phone
 * @returns {string}
 */
function speakPhone(phone) {
  const digits = phone.replace(/\D/g, '')
  if (digits.length < 7) return phone
  // Group for clearer pacing: "5 5 5, 1 2 3, 4 5 6 7"
  const groups = []
  let rest = digits
  if (rest.length === 11 && rest.startsWith('1')) {
    groups.push(rest[0])
    rest = rest.slice(1)
  }
  if (rest.length >= 10) {
    groups.push(rest.slice(0, 3), rest.slice(3, 6), rest.slice(6, 10))
    rest = rest.slice(10)
  } else if (rest.length === 7) {
    groups.push(rest.slice(0, 3), rest.slice(3))
    rest = ''
  } else {
    return digits.split('').join(' ')
  }
  if (rest) groups.push(rest)
  return groups.map((g) => g.split('').join(' ')).join(', ')
}
