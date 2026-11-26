import { t } from '@/lib/i18n';
import { VOICE_RECOGNITION_DISABLED } from '@/lib/tauri';
import { describeTranscriptionError } from '@/lib/transcription/errors';

/**
 * The voice-analysis backend's failures in the app's language, for the ones a
 * person can act on. Anything else is shown as the backend wrote it: a precise
 * English sentence is more use than a vague translated one.
 */

export function isVoiceModelMissing(message: string | null | undefined): boolean {
  return /voice models? (are|is) not downloaded/i.test(message ?? '');
}

export function describeSpeakerError(error: unknown): string {
  const raw = String(error instanceof Error ? error.message : (error ?? ''))
    .replace(/^Error:\s*/, '')
    .trim();
  if (!raw) return t('transcription.errorUnknown');
  if (isVoiceModelMissing(raw)) return t('speakers.error.modelMissing');
  if (raw.includes(VOICE_RECOGNITION_DISABLED)) return t('speakers.error.notEnabled');
  const speech = /^Not enough speech to learn the voice: found ([\d.,]+) s of speech, need at least ([\d.,]+) s/i.exec(raw);
  if (speech) return t('speakers.error.notEnoughSpeech', { found: speech[1], needed: speech[2] });
  if (/^The voice models are in use/i.test(raw)) return t('speakers.error.modelInUse');
  if (/^Voice models are already being downloaded/i.test(raw)) return t('speakers.error.alreadyDownloading');
  if (/made with another voice model/i.test(raw)) return t('speakers.error.otherModel');
  if (/^A voice profile needs a name/i.test(raw)) return t('speakers.error.needsName');
  if (/^The name is too long/i.test(raw)) return t('speakers.error.nameTooLong');
  if (/^Could not load the voice model/i.test(raw)) return t('speakers.error.modelDamaged');
  if (/^The recording has no audio in that range/i.test(raw)) return t('speakers.error.noAudioInRange');
  // Audio missing, still in iCloud, undecodable, disk full: the transcription
  // errors, word for word.
  return describeTranscriptionError(raw);
}
