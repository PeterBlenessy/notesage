import { useEffect } from "react";
import { toggleMeetingRecording } from "@/hooks/useMeetingRecording";

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
      void toggleMeetingRecording();
    };
    window.addEventListener("notesage:toggle-recording", handle);
    return () => window.removeEventListener("notesage:toggle-recording", handle);
  }, []);
}
