/**
 * Spoken-language options for transcription, and how the default is chosen.
 *
 * The list lived in two components (Settings and the recording card) as
 * identical copies. They happened not to have drifted, which is luck rather
 * than structure — a language added to one picker and not the other is exactly
 * the kind of difference nobody notices until a user cannot select their own
 * language in one of the two places.
 */

export interface SpeechLanguage {
  value: string;
  label: string;
}

/**
 * Whisper supports 99 languages; these are the common picks. `auto` asks
 * Whisper to detect per recording.
 *
 * Auto-detect is NOT the default any more. Measured on a Swedish corpus, it
 * cost every model up to 10 points of word error, and in the worst case a
 * model decided a Swedish clip was Albanian and transliterated it — 100% word
 * error on audio it had heard correctly. Detection is reliable for English and
 * unreliable elsewhere, so the default now follows the device language and
 * auto-detect is something the user opts into.
 * See `docs/transcription-model-comparison.md`.
 */
export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'ar', label: 'Arabic' },
  { value: 'zh', label: 'Chinese' },
  { value: 'cs', label: 'Czech' },
  { value: 'da', label: 'Danish' },
  { value: 'nl', label: 'Dutch' },
  { value: 'en', label: 'English' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'el', label: 'Greek' },
  { value: 'hi', label: 'Hindi' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'no', label: 'Norwegian' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
  { value: 'es', label: 'Spanish' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
  { value: 'uk', label: 'Ukrainian' },
  { value: 'vi', label: 'Vietnamese' },
] as const;

/** Human-readable name for a stored language value. */
export function speechLanguageLabel(value: string): string {
  return SPEECH_LANGUAGES.find((l) => l.value === value)?.label ?? value;
}

/**
 * The language to transcribe in when the user has not chosen one: the device's
 * own language, when we offer it.
 *
 * A recording can of course be in any language regardless of the OS setting —
 * which is why the choice is shown on the recording itself and can be changed
 * per transcription. This only decides the starting point, and the device
 * language is a far better guess than asking Whisper to work it out.
 *
 * Falls back to English when the device language is not in the list, rather
 * than to `auto`: a wrong-but-fixable language produces text the user can see
 * is wrong, whereas auto-detect produces confident nonsense in a script they
 * may not recognise.
 */
export function detectSpeechLanguage(): string {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = [...(navigator.languages ?? []), navigator.language];
  for (const candidate of candidates) {
    const base = (candidate ?? '').toLowerCase().split('-')[0];
    if (SPEECH_LANGUAGES.some((l) => l.value === base)) return base;
  }
  return 'en';
}

/**
 * Models that are only good at English (`docs/transcription-model-comparison.md`).
 *
 * `small` measures 1.0% word error on English and 25.6% on Swedish — not
 * "slightly worse", but roughly one word in four. Pairing it with another
 * language is the one model/language combination that quietly produces bad
 * output, so the UI says so rather than letting the user discover it in the
 * transcript.
 */
const ENGLISH_ONLY_MODELS = new Set(['small', 'base', 'tiny']);

export function isEnglishOnlyModel(model: string): boolean {
  return ENGLISH_ONLY_MODELS.has(model);
}

/** Whether this model/language pair is the known-bad combination. */
export function isLanguageMismatch(model: string, language: string): boolean {
  if (!isEnglishOnlyModel(model)) return false;
  // `auto` counts: detection is what sends these models astray in the first
  // place, and they have no headroom to recover from a wrong guess.
  return language !== 'en';
}
