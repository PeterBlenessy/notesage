import { useEffect, useState } from 'react';
import { Mic, MonitorSpeaker, Users } from 'lucide-react';
import {
  RECORDING_SOURCES,
  useRecordingStore,
  type RecordingSource,
} from '@/stores/recording-store';
import { preflightRecording, sourceUnavailableReason } from '@/hooks/useMeetingRecording';
import { recordingSourceLabel } from '@/hooks/useRecording';
import type { RecordingPreflight } from '@/lib/tauri';
import { t } from '@/lib/i18n';
import { useLocale } from '@/lib/useLocale';
import { cn } from '@/lib/utils';

const ICONS = { microphone: Mic, system: MonitorSpeaker, both: Users } as const;

function shortLabel(source: RecordingSource): string {
  if (source === 'system') return t("recording.source.system");
  if (source === 'both') return t("recording.source.bothShort");
  return t("recording.source.microphone");
}

/**
 * What the next recording captures: Microphone, System audio, or Both (N1).
 *
 * A segmented control over `recording-store.lastUsedSource` — the one
 * persisted choice that `⌘⇧R`, the Record buttons and Settings → Transcription
 * all share. An option that cannot be recorded right now stays visible,
 * cannot be chosen, and says why in plain words underneath ("Needs macOS 14.2
 * or later"), because a greyed-out button with no reason reads as a bug.
 *
 * Asks the backend once on mount (`recording_preflight`, which never prompts
 * for permission). With no answer, everything stays selectable and
 * `start_recording` is the judge.
 */
export function RecordingSourcePicker({
  disabled = false,
  className,
}: {
  /** While a recording is live its source cannot change. */
  disabled?: boolean;
  className?: string;
}) {
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const selected = useRecordingStore((s) => s.lastUsedSource);
  const setSelected = useRecordingStore((s) => s.setLastUsedSource);
  const [preflight, setPreflight] = useState<RecordingPreflight | null>(null);

  useEffect(() => {
    let mounted = true;
    void preflightRecording('both').then((result) => {
      if (mounted) setPreflight(result);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const reasons = RECORDING_SOURCES.map((source) => ({
    source,
    reason: sourceUnavailableReason(source, preflight),
  }));
  // One sentence per distinct reason, naming the options it applies to.
  const explained = new Map<string, RecordingSource[]>();
  for (const { source, reason } of reasons) {
    if (reason) explained.set(reason, [...(explained.get(reason) ?? []), source]);
  }

  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div
        role="radiogroup"
        aria-label={t("recording.source.label")}
        data-recording-source-picker
        className="flex gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
      >
        {reasons.map(({ source, reason }) => {
          const Icon = ICONS[source];
          const unavailable = disabled || reason !== null;
          const checked = selected === source;
          return (
            <button
              key={source}
              type="button"
              role="radio"
              aria-checked={checked}
              // `aria-disabled`, not `disabled`: the option stays focusable so
              // a keyboard or screen-reader user can reach it and hear why.
              aria-disabled={unavailable}
              aria-label={reason ? `${recordingSourceLabel(source)}. ${reason}` : recordingSourceLabel(source)}
              title={reason ?? recordingSourceLabel(source)}
              data-source={source}
              onClick={() => {
                if (!unavailable) setSelected(source);
              }}
              className={cn(
                'flex h-7 min-w-0 flex-auto items-center justify-center gap-1 rounded-[5px] px-1.5 text-xs',
                'transition-colors duration-150',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                checked
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground',
                unavailable ? 'cursor-not-allowed opacity-50' : !checked && 'hover:text-foreground',
              )}
            >
              <Icon className="size-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <span className="truncate">{shortLabel(source)}</span>
            </button>
          );
        })}
      </div>
      {[...explained.entries()].map(([reason, sources]) => (
        <p key={reason} data-recording-source-reason className="text-[11px] leading-snug text-muted-foreground">
          {t("recording.source.unavailable", {
            sources: sources.map(shortLabel).join(', '),
            reason,
          })}
        </p>
      ))}
    </div>
  );
}
