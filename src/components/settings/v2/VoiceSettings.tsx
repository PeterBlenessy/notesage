import { TranscriptionSettings as LegacyTranscriptionSettings } from '../TranscriptionSettings';
import { SettingsGroup } from './SettingsGroup';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';

/**
 * Voice settings panel (v2).
 *
 * Wraps the legacy `<TranscriptionSettings>` component which owns the
 * Whisper model catalog (downloads, delete, set default), the recording
 * language picker, and the transcription-model default. Mounted `bare`
 * because the legacy component renders its own internal section headers
 * and cards — the tinted island would double up.
 *
 * Lives as a standalone panel rather than under AI Providers because
 * speech-to-text is a different concern (transcription, not LLM
 * inference) and has its own model management story.
 */
export function VoiceSettings() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  return (
    <SettingsGroup
      label={t("settings.transcription")}
      description="Whisper models for transcribing meeting recordings. Models run on-device — audio never leaves your machine."
      bare
    >
      <div className="py-2">
        <LegacyTranscriptionSettings />
      </div>
    </SettingsGroup>
  );
}
