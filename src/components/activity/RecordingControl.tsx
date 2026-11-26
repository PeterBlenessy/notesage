import { Loader2, Mic, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useMeetingRecording } from '@/hooks/useMeetingRecording';
import { recordingSourceLabel } from '@/hooks/useRecording';
import { useRecordingStore } from '@/stores/recording-store';
import { formatRecordedTime } from '@/lib/recording-time';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';
import { log } from '@/lib/logger';
import { cn } from '@/lib/utils';

/**
 * Start / stop a recording, in the AgentOrb panel header (#696).
 *
 * The old entry point was a microphone inside `StatusTray` → `EditorToolsGroup`,
 * which returns null without a live `editor`. Once the status strip moved into
 * the sidebar footer, two of the three `SidebarStatusBar` mounts passed
 * `editor={null}`, so the button existed only with a markdown editor open AND
 * the tray popover expanded. It was never deleted — it was orphaned, and
 * `⌘⇧R` became the only reliable way to record.
 *
 * The orb is the honest home: it already owns recording and transcription
 * state, and it is always mounted, unlike the editor-scoped tray.
 *
 * A labelled button, not a bare 14px glyph: "Record" with the source it will
 * capture, "Stop" with the recorded time while one is live, "Saving…" while
 * the audio is being compressed (when a second start would be refused).
 */
export function RecordingControl() {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const { toggleRecording, isRecording, elapsedTime, phase } = useMeetingRecording();
  const nextSource = useRecordingStore((s) => s.lastUsedSource);
  const busy = phase === 'starting' || phase === 'stopping';

  const label =
    phase === 'stopping'
      ? t("recording.state.saving")
      : phase === 'starting'
        ? t("recording.state.starting")
        : isRecording
          ? t("recording.stopShort")
          : t("recording.start");
  const tooltip = isRecording
    ? t("recording.stopAndSave")
    : t("recording.startWith", { source: recordingSourceLabel(nextSource) });

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-testid="recording-control"
            onClick={() => {
              void toggleRecording().catch((err) =>
                log.warn('recording', 'Toggle recording failed', err),
              );
            }}
            disabled={busy}
            aria-pressed={isRecording}
            aria-label={busy ? label : tooltip}
            className={cn('shrink-0', isRecording && 'text-[var(--color-destructive)]')}
          >
            {busy ? (
              <Loader2
                className="size-3 animate-spin motion-reduce:animate-none"
                strokeWidth={1.5}
                aria-hidden="true"
              />
            ) : isRecording ? (
              <Square className="size-3 fill-current" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Mic className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            )}
            <span>{label}</span>
            {isRecording && !busy ? (
              <span className="tabular-nums">{formatRecordedTime(elapsedTime)}</span>
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2 text-xs">
          <span>{tooltip}</span>
          <kbd className="font-sans text-[10px] text-muted-foreground">⌘⇧R</kbd>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
