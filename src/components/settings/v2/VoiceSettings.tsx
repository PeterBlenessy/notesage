import { TranscriptionSettings as LegacyTranscriptionSettings } from '../TranscriptionSettings';
import { SettingsGroup } from './SettingsGroup';

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
  return (
    <SettingsGroup
      label="Transcription"
      description="Whisper models for transcribing meeting recordings. Models run on-device — audio never leaves your machine."
      bare
    >
      <div className="py-2">
        <LegacyTranscriptionSettings />
      </div>
    </SettingsGroup>
  );
}
