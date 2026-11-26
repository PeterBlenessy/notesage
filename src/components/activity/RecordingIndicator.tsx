import { AlertTriangle, Loader2, Pause, Play, Square, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useRecordingStore, type RecordingWarning } from '@/stores/recording-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  recordingWarningText,
  requestDiscardMeetingRecording,
  stopMeetingRecording,
  togglePauseMeetingRecording,
} from '@/hooks/useMeetingRecording';
import { recordingSourceLabel } from '@/hooks/useRecording';
import { formatRecordedTime } from '@/lib/recording-time';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';
import { log } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { RecordingLevelMeter } from './RecordingLevelMeter';

function run(action: () => Promise<void>): void {
  void action().catch((err) => log.warn('recording', 'Recording control failed', err));
}

/** What is being captured, with the device names: the tooltip on the source label. */
function deviceLines(
  source: 'microphone' | 'system' | 'both',
  input: string | null,
  output: string | null,
): string[] {
  const lines: string[] = [];
  if (source !== 'system') {
    lines.push(
      input
        ? t("recording.device.microphone", { device: input })
        : t("recording.device.microphoneDefault"),
    );
  }
  if (source !== 'microphone') {
    lines.push(
      output
        ? t("recording.device.system", { device: output })
        : t("recording.device.systemDefault"),
    );
  }
  return lines;
}

function WarningRow({ warning, compact }: { warning: RecordingWarning; compact: boolean }) {
  const text = recordingWarningText(warning.kind, warning.source);
  return (
    <span
      data-recording-warning={warning.kind}
      className={cn(
        'flex min-w-0 items-start gap-1.5 text-xs text-foreground',
        compact && 'items-center',
      )}
    >
      <AlertTriangle
        className="mt-px size-3.5 shrink-0 text-[var(--color-destructive)]"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <span className={cn('min-w-0 flex-1', compact && 'truncate')} title={compact ? text : undefined}>
        {text}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t("recording.warning.dismiss")}
        onClick={() => useRecordingStore.getState().dismissWarning(warning.kind, warning.source)}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
      </Button>
    </span>
  );
}

/**
 * The always-visible recording indicator (U2, U3).
 *
 * Two placements of one component, so they can never disagree:
 *
 *  - `sidebar`: a row of its own above the sidebar footer. Its own row, not
 *    the footer row: that row already holds the Settings button and the
 *    status strip at sidebar widths down to 200px, and it has been the site
 *    of two overlap bugs.
 *  - `floating`: a small chip fixed to the bottom-left of the document
 *    column, shown when the sidebar is not (hidden, focus mode, faded while
 *    typing). It sits in the strip BELOW the floating command bar
 *    (`bottom-10`), so it cannot cover the bar, the caret band above it, the
 *    orb, or — being offset by the sidebar's width — the Settings button and
 *    status strip. Which of the two is on screen is decided in CSS
 *    (`globals.css`, "Recording indicator"), because focus mode and
 *    fade-on-type are classes on the layout root, not React state.
 *
 * Says what it is in words, not colour: the state ("Recording", "Paused",
 * "Saving…"), the recorded time, and what is being captured. The dot is the
 * destructive red, not the accent (which is grey in the default theme), and
 * changes SHAPE when paused. Renders nothing while idle.
 *
 * Deliberately has no live region: both placements can be mounted at once,
 * and one announcement must not be read twice. `RecordingStatusHost` owns it.
 */
export function RecordingIndicator({ variant }: { variant: 'sidebar' | 'floating' }) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const phase = useRecordingStore((s) => s.phase);
  const source = useRecordingStore((s) => s.recordingSource);
  const seconds = useRecordingStore((s) => s.recordedSeconds);
  const inputDevice = useRecordingStore((s) => s.inputDevice);
  const outputDevice = useRecordingStore((s) => s.outputDevice);
  const warnings = useRecordingStore((s) => s.warnings);
  const sidebarPinned = useSettingsStore((s) => s.sidebarPinned);

  if (phase === 'idle' || phase === 'starting') return null;

  const paused = phase === 'paused';
  const saving = phase === 'stopping';
  const floating = variant === 'floating';
  const stateLabel = saving
    ? t("recording.state.saving")
    : paused
      ? t("recording.state.paused")
      : t("recording.state.recording");
  const sourceLabel = recordingSourceLabel(source);
  const time = formatRecordedTime(seconds);

  const dot = saving ? (
    <Loader2
      data-recording-dot="saving"
      className="size-3 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
      strokeWidth={1.5}
      aria-hidden="true"
    />
  ) : (
    <span
      data-recording-dot={paused ? 'paused' : 'recording'}
      aria-hidden="true"
      className={cn(
        'size-2.5 shrink-0 rounded-full',
        paused
          ? // Hollow while paused: a different shape, not just a dimmer red.
            'border-[1.5px] border-[var(--color-destructive)]'
          : 'bg-[var(--color-destructive)] animate-pulse motion-reduce:animate-none',
      )}
    />
  );

  const timer = (
    <span
      data-recording-time
      className="shrink-0 text-xs font-medium tabular-nums text-foreground"
    >
      {time}
    </span>
  );

  const state = (
    <span data-recording-state className="shrink-0 text-xs font-medium text-foreground">
      {stateLabel}
    </span>
  );

  const sourceWithDevices = (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-recording-source
          tabIndex={0}
          className="min-w-0 truncate rounded-sm text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {sourceLabel}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {deviceLines(source, inputDevice, outputDevice).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </TooltipContent>
    </Tooltip>
  );

  const pauseLabel = paused ? t("recording.resume") : t("recording.pause");
  const controls = (
    <span className="flex shrink-0 items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={pauseLabel}
            aria-pressed={paused}
            disabled={saving}
            onClick={() => run(togglePauseMeetingRecording)}
            className="text-muted-foreground hover:text-foreground"
          >
            {paused ? (
              <Play className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Pause className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2 text-xs">
          <span>{pauseLabel}</span>
          <kbd className="font-sans text-[10px] text-muted-foreground">⌘⇧U</kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("recording.stopAndSave")}
            disabled={saving}
            onClick={() => run(stopMeetingRecording)}
            className="text-[var(--color-destructive)] hover:text-[var(--color-destructive)]"
          >
            <Square className="size-3.5 fill-current" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2 text-xs">
          <span>{t("recording.stopAndSave")}</span>
          <kbd className="font-sans text-[10px] text-muted-foreground">⌘⇧R</kbd>
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("recording.discardRecording")}
            disabled={saving}
            onClick={requestDiscardMeetingRecording}
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {t("recording.discardRecording")}
        </TooltipContent>
      </Tooltip>
    </span>
  );

  const meter = saving ? null : <RecordingLevelMeter source={source} paused={paused} />;

  if (floating) {
    const warning = warnings[0];
    return (
      <TooltipProvider delayDuration={300}>
        <div
          role="group"
          aria-label={t("recording.indicatorLabel")}
          data-recording-indicator="floating"
          data-recording-chip
          data-recording-phase={phase}
          data-sidebar-pinned={sidebarPinned ? 'true' : 'false'}
          className={cn(
            // Bottom-left of the document column, in the 40px strip under the
            // floating command bar (`bottom-10`): 8px + 28px tall = 36px.
            'fixed bottom-2 left-[calc(var(--quiet-sidebar-width,0px)+12px)] z-40',
            'flex h-7 max-w-[min(34rem,calc(100vw-24px))] items-center gap-2 rounded-full pl-2.5 pr-1',
            'border border-border bg-popover text-popover-foreground shadow-md',
          )}
        >
          {dot}
          {state}
          {timer}
          {meter}
          {warning ? <WarningRow warning={warning} compact /> : sourceWithDevices}
          {controls}
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div
        role="group"
        aria-label={t("recording.indicatorLabel")}
        data-recording-indicator="sidebar"
        data-recording-phase={phase}
        // Keystrokes on the controls must not leak into the sidebar's
        // type-to-filter handler (same isolation as the footer).
        onKeyDown={(e) => e.stopPropagation()}
        className="mt-2 flex shrink-0 flex-col gap-1 rounded-md border border-border bg-muted/40 px-2 py-1.5"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {dot}
          {timer}
          <span className="min-w-0 flex-1" />
          {controls}
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          {state}
          {meter}
          {sourceWithDevices}
        </div>
        {warnings.map((warning) => (
          <WarningRow key={`${warning.kind}-${warning.source ?? 'any'}`} warning={warning} compact={false} />
        ))}
      </div>
    </TooltipProvider>
  );
}
