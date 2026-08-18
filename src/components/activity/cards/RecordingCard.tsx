import { useState } from 'react';
import { Loader2, Square, Mic, Pause, Circle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useActivityStore, type AgentTask } from '@/stores/activity-store';
import { useRecordingStore } from '@/stores/recording-store';
import { useMeetingRecording } from '@/hooks/useMeetingRecording';
import { formatStopwatchMs } from '@/lib/recording-time';
import { IconActionButton, formatClock } from './shared';
import { useFormatLocale } from "@/lib/useLocale";

// Whisper supports 99 languages; "Auto-detect" covers them all. Mirrors the
// explicit-pick subset in `TranscriptionSettings` — this is the per-recording
// override, made available right where the decision belongs (at record time,
// not buried in Settings). Keep "Auto-detect" first.
const LANGUAGES = [
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
];

/**
 * Live-recording card (kind === 'recording'). Recording glyph + a pause-aware
 * stopwatch, plus inline pause/resume and stop controls so the orb panel is a
 * full recording remote — not a dead end pointing at the status bar.
 *
 * Stop goes through `useMeetingRecording.toggleRecording`, the same shared
 * flow the StatusTray MicButton and `⌘⇧R` use (module-scoped live-item id, so
 * stopping from here clears the orb indicator regardless of which surface
 * started the capture) — and then kicks off the background transcription.
 */
export function RecordingCard({ task }: { task: AgentTask }) {
  // Subscribe to language changes: the formatting helpers below read the
  // i18n module directly, so without this the rendered dates/numbers would
  // keep their old locale until some unrelated state forced a re-render.
  useFormatLocale();

  const { toggleRecording, pauseRecording, resumeRecording, isPaused, elapsedTime } =
    useMeetingRecording();
  const [stopping, setStopping] = useState(false);
  const settingsLanguage = useRecordingStore((s) => s.speechLanguage);
  const setRecordingLanguage = useActivityStore((s) => s.setRecordingLanguage);
  const effectiveLanguage = task.language ?? settingsLanguage;

  const handleStop = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await toggleRecording();
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="group/card px-3 py-2.5 min-w-0 overflow-hidden">
      <div className="flex items-center gap-2">
        <Mic
          className={`h-3.5 w-3.5 shrink-0 ${
            isPaused ? 'text-muted-foreground' : 'text-[var(--color-accent-primary)]'
          }`}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-medium text-foreground truncate">
            {task.label}
          </p>
          <p className="text-xs text-muted-foreground">
            {isPaused ? 'Paused' : 'Recording…'}
            {task.recordingStartedAt && (
              <span className="text-muted-foreground/70"> · started {formatClock(task.recordingStartedAt)}</span>
            )}
          </p>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {formatStopwatchMs(elapsedTime * 1000)}
        </span>
        <IconActionButton
          label={isPaused ? 'Resume recording' : 'Pause recording'}
          onClick={(e) => {
            e.stopPropagation();
            void (isPaused ? resumeRecording() : pauseRecording());
          }}
          disabled={stopping}
          className="shrink-0 h-5 w-5 text-muted-foreground hover:text-foreground"
        >
          {isPaused ? (
            // Record dot — "press to go back to recording". Unfilled stroke to
            // match the pause/stop glyphs' weight.
            <Circle className="h-3 w-3" strokeWidth={1.5} />
          ) : (
            <Pause className="h-3 w-3" strokeWidth={1.5} />
          )}
        </IconActionButton>
        <IconActionButton
          label="Stop recording"
          onClick={(e) => {
            e.stopPropagation();
            void handleStop();
          }}
          disabled={stopping}
          className="shrink-0 h-5 w-5 text-muted-foreground hover:text-foreground"
        >
          {stopping ? (
            <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.5} />
          ) : (
            <Square className="h-3 w-3" strokeWidth={1.5} />
          )}
        </IconActionButton>
      </div>

      {/* Per-recording language override (#698) — defaults to the Settings
          value, made overridable right here at record time. */}
      <div className="pl-5 mt-1.5 flex items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground/80">Language</span>
        <Select
          value={effectiveLanguage}
          onValueChange={(value) => setRecordingLanguage(task.id, value)}
        >
          <SelectTrigger
            size="sm"
            aria-label="Recording language"
            className="h-6 w-28 px-2 text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent onClick={(e) => e.stopPropagation()}>
            {LANGUAGES.map((lang) => (
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
