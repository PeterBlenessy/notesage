import { useEffect } from "react";
import {
  initRecordingEvents,
  toggleMeetingRecording,
  togglePauseMeetingRecording,
} from "@/hooks/useMeetingRecording";
import { log } from "@/lib/logger";

export const TOGGLE_RECORDING_EVENT = "notesage:toggle-recording";
export const TOGGLE_RECORDING_PAUSE_EVENT = "notesage:toggle-recording-pause";

/**
 * Wires the global `notesage:toggle-recording` event (⌘⇧R) to meeting
 * recording.
 *
 * MUST be mounted somewhere always-alive. It previously lived in
 * `TranscriptionOverlay`, inside the editor — so ⌘⇧R silently did nothing
 * whenever no editor was mounted (empty state, PDF/EPUB viewer, code file).
 * Combined with the orphaned status-tray microphone (#696), that left the
 * feature unreachable in exactly the states where you would reach for it.
 *
 * Same rule as the other global listeners: agent, proxy and notification
 * listeners all mount at the app root rather than inside a surface that can
 * unmount (see `project_always_mounted_listeners`).
 */
export function useRecordingShortcut(): void {
  // Deliberately NOT `useMeetingRecording()`: that hook carries the reactive
  // recording state, including a once-a-second `elapsedTime` tick, and this
  // one is mounted in `App` — every tick re-rendered the whole tree (audit
  // 2026-11-22 §3). The shortcut only has to act, so it calls the imperative
  // toggle, which reads `isRecording` lazily. It subscribes to nothing.
  useEffect(() => {
    const handle = () => {
      void toggleMeetingRecording().catch((err) => {
        log.warn("recording", "Toggle recording failed", err);
      });
    };
    // ⌘⇧U: pause a running recording, resume a paused one.
    const handlePause = () => {
      void togglePauseMeetingRecording().catch((err) => {
        log.warn("recording", "Pause/resume failed", err);
      });
    };
    window.addEventListener(TOGGLE_RECORDING_EVENT, handle);
    window.addEventListener(TOGGLE_RECORDING_PAUSE_EVENT, handlePause);
    // The backend's level and warning events have the same "always mounted"
    // requirement as the shortcut: a warning about a lost microphone must
    // arrive whatever is on screen.
    const stopEvents = initRecordingEvents();
    return () => {
      window.removeEventListener(TOGGLE_RECORDING_EVENT, handle);
      window.removeEventListener(TOGGLE_RECORDING_PAUSE_EVENT, handlePause);
      stopEvents();
    };
  }, []);
}
