/** Curated English voices; mirrors junco-ios KokoroVoiceCatalog. */
export const VOICES = [
  { id: 'af_heart', displayName: 'Heart', gender: 'female', accent: 'american', note: null },
  { id: 'af_bella', displayName: 'Bella', gender: 'female', accent: 'american', note: null },
  { id: 'af_nicole', displayName: 'Nicole', gender: 'female', accent: 'american', note: 'ASMR-ish' },
  { id: 'am_michael', displayName: 'Michael', gender: 'male', accent: 'american', note: null },
  { id: 'am_fenrir', displayName: 'Fenrir', gender: 'male', accent: 'american', note: null },
  { id: 'bf_emma', displayName: 'Emma', gender: 'female', accent: 'british', note: null },
  { id: 'bm_george', displayName: 'George', gender: 'male', accent: 'british', note: null },
  { id: 'bm_fable', displayName: 'Fable', gender: 'male', accent: 'british', note: null },
]

export const DEFAULT_VOICE_ID = VOICES[0].id

export function voiceById(id) {
  return VOICES.find((v) => v.id === id) ?? VOICES[0]
}
