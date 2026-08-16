import { Mic, Square } from 'lucide-react';
import { useMeetingRecording } from '@/hooks/useMeetingRecording';
import { cn } from '@/lib/utils';

/** `mm:ss`, or `h:mm:ss` once a recording runs past an hour. */
function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Start / stop a voice recording, in the AgentOrb panel header (#696).
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
 */
export function RecordingControl() {
  const { toggleRecording, isRecording, elapsedTime } = useMeetingRecording();

  return (
    <button
      type="button"
      onClick={() => void toggleRecording()}
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
      title={isRecording ? 'Stop recording (⌘⇧R)' : 'Start recording (⌘⇧R)'}
      className={cn(
        'ios-press-row flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs',
        'transition-colors hover:bg-muted',
        isRecording ? 'text-[var(--color-destructive)]' : 'text-muted-foreground',
      )}
    >
      {isRecording ? (
        <>
          <Square strokeWidth={1.5} className="h-3 w-3 fill-current" />
          <span className="tabular-nums">{formatElapsed(elapsedTime)}</span>
        </>
      ) : (
        <Mic strokeWidth={1.5} className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
