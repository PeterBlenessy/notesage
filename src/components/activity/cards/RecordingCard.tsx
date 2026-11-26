import { Loader2, Square, Mic, Pause, Play, Trash2 } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { SPEECH_LANGUAGES } from '@/lib/transcription/languages';
import {
  requestDiscardMeetingRecording,
  stopMeetingRecording,
  useMeetingRecording,
} from '@/hooks/useMeetingRecording';
import { recordingSourceLabel } from '@/hooks/useRecording';
import { formatRecordedTime } from '@/lib/recording-time';
import { log } from '@/lib/logger';
import { IconActionButton, formatClock } from './shared';
import { useFormatLocale } from "@/lib/useLocale";
import { t } from "@/lib/i18n";


/**
 * Live-recording card (kind === 'recording'). Recording glyph + the recorded
 * time, plus inline pause/resume, stop and discard so the orb panel is a full
 * recording remote — not a dead end pointing at the status bar.
 *
 * Every control goes through `useMeetingRecording`'s shared flow, the same
 * one the indicator, the toolbar microphone and `⌘⇧R` use — so stopping from
 * here clears the indicator whichever surface started the capture, and
 * "saving" is the flow's own phase rather than a flag local to this card.
 */
export function RecordingCard({ task }: { task: AgentTask }) {
  // Subscribe to language changes: the formatting helpers below read the
  // i18n module directly, so without this the rendered dates/numbers would
  // keep their old locale until some unrelated state forced a re-render.
  useFormatLocale();

  const { pauseRecording, resumeRecording, isPaused, elapsedTime, phase, source } =
    useMeetingRecording();
  const stopping = phase === 'stopping';
  const settingsLanguage = useRecordingStore((s) => s.speechLanguage);
  const setRecordingLanguage = useActivityStore((s) => s.setRecordingLanguage);
  const effectiveLanguage = task.language ?? settingsLanguage;

  const handleStop = () => {
    void stopMeetingRecording().catch((err) => log.warn('recording', 'Stop failed', err));
  };
  const stateLabel = stopping
    ? t("recording.state.saving")
    : isPaused
      ? t("recording.state.paused")
      : t("recording.state.recording");

  return (
    <div className="group/card px-3 py-2.5 min-w-0 overflow-hidden">
      <div className="flex items-center gap-2">
        <Mic
          className={`h-3.5 w-3.5 shrink-0 ${
            isPaused || stopping ? 'text-muted-foreground' : 'text-[var(--color-destructive)]'
          }`}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate">
            {stateLabel} · {recordingSourceLabel(source)}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {task.recordingStartedAt
              ? t("recording.card.started", { time: formatClock(task.recordingStartedAt) ?? "" })
              : ''}
          </p>
        </div>
        <span className="text-xs text-foreground tabular-nums shrink-0">
          {formatRecordedTime(elapsedTime)}
        </span>
        <IconActionButton
          label={isPaused ? t("recording.resume") : t("recording.pause")}
          onClick={(e) => {
            e.stopPropagation();
            void (isPaused ? resumeRecording() : pauseRecording());
          }}
          disabled={stopping}
          className="shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          {isPaused ? (
            <Play className="h-3.5 w-3.5" strokeWidth={1.5} />
          ) : (
            <Pause className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </IconActionButton>
        <IconActionButton
          label={t("recording.stopAndSave")}
          onClick={(e) => {
            e.stopPropagation();
            handleStop();
          }}
          disabled={stopping}
          className="shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          {stopping ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={1.5} />
          ) : (
            <Square className="h-3.5 w-3.5" strokeWidth={1.5} />
          )}
        </IconActionButton>
        <IconActionButton
          label={t("recording.discardRecording")}
          onClick={(e) => {
            e.stopPropagation();
            requestDiscardMeetingRecording();
          }}
          disabled={stopping}
          className="shrink-0 h-6 w-6 text-muted-foreground hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        </IconActionButton>
      </div>

      {/* Per-recording language override (#698) — defaults to the Settings
          value, made overridable right here at record time. */}
      <div className="pl-5 mt-1.5 flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">{t("activity.language")}</span>
        <Select
          value={effectiveLanguage}
          onValueChange={(value) => setRecordingLanguage(task.id, value)}
        >
          <SelectTrigger
            size="sm"
            aria-label={t("activity.recordingLanguage")}
            className="h-6 w-28 px-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent onClick={(e) => e.stopPropagation()}>
            {SPEECH_LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value}>
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
