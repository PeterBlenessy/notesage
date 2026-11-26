import { t } from '@/lib/i18n';

/**
 * Backend failures arrive as English strings. The ones a person can act on
 * are recognised here and shown in the app's language; anything else is shown
 * as the backend wrote it, because a precise English sentence is more use
 * than a vague translated one.
 */

/** The exact text `transcribe_file` rejects with after `cancel_transcription`. */
export const TRANSCRIPTION_CANCELLED = 'Transcription cancelled';

/** The marker the scanner writes for a job that died with the app. */
export const TRANSCRIPTION_INTERRUPTED = 'interrupted';

export function isCancellation(error: unknown): boolean {
  return String(error).includes(TRANSCRIPTION_CANCELLED);
}

/** What `import_media` rejects with after the user cancelled it: nothing to report. */
export function isImportCancellation(error: unknown): boolean {
  return String(error).includes('Import cancelled');
}

/** "Model 'x' not downloaded…" and its relatives: the fix is in Settings. */
export function isModelMissingError(message: string | null | undefined): boolean {
  if (!message) return false;
  return /model\b.*\b(not downloaded|not found|missing)|no (whisper )?model|failed to load whisper model/i.test(message);
}

export function modelNameFromError(message: string): string | null {
  return /model '([^']+)'/i.exec(message)?.[1] ?? null;
}

/** A failure reason in the app's language where it is one we know. */
export function describeTranscriptionError(message: string | null | undefined): string {
  const raw = (message ?? '').replace(/^Error:\s*/, '').trim();
  if (!raw) return t('transcription.errorUnknown');
  if (raw === TRANSCRIPTION_INTERRUPTED) return t('transcription.errorInterrupted');
  if (isModelMissingError(raw)) {
    const model = modelNameFromError(raw);
    return model ? t('transcription.errorModelMissingNamed', { model }) : t('transcription.errorModelMissing');
  }
  if (/(audio|source) file not found/i.test(raw)) return t('transcription.errorAudioMissing');
  if (/still in icloud|not downloaded from icloud/i.test(raw)) return t('recordings.audioNotLocal');
  if (/contains no samples|no audio (track|stream)/i.test(raw)) return t('transcription.errorNoAudio');
  if (/unsupported|unrecogni[sz]ed (audio )?(format|container)|could not decode|failed to decode/i.test(raw)) {
    return t('transcription.errorUnsupported', { detail: raw });
  }
  if (/no space left|disk full|not enough (free )?(disk )?space/i.test(raw)) return t('transcription.errorDiskFull');
  return raw;
}
