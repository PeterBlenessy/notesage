import { useState } from 'react';
import { Loader2, Square, Mic, Pause, Circle } from 'lucide-react';
import type { AgentTask } from '@/stores/activity-store';
import { useMeetingRecording } from '@/hooks/useMeetingRecording';
import { formatStopwatchMs } from '@/lib/recording-time';
import { IconActionButton, formatClock } from './shared';

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
  const { toggleRecording, pauseRecording, resumeRecording, isPaused, elapsedTime } =
    useMeetingRecording();
  const [stopping, setStopping] = useState(false);

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
    </div>
  );
}
