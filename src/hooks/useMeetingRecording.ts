import { useCallback, useRef } from "react";
import { toast } from "sonner";
import { useRecording } from "@/hooks/useRecording";
import { useActivityStore } from "@/stores/activity-store";
import { startTranscription } from "@/hooks/useTranscriptionJob";

/**
 * Single owner of the meeting-recording start/stop flow shared by every
 * surface that can toggle recording (the StatusTray `MicButton` and the
 * `⌘⇧R` chord).
 *
 * Lifecycle (mirrors the PRD `Recording → Transcribing → Ready` story):
 *   - START: kick off mic capture (`source: 'microphone'`) and add a
 *     `recording` activity item so the AgentOrb shows a live indicator.
 *   - STOP: stop capture → get the finalized WAV → remove the recording
 *     activity item → fire the decoupled `notesage:start-transcription`
 *     trigger so `useTranscriptionJob` runs the background transcription.
 *
 * The recording activity item uses a stable id captured on START and reused
 * on STOP so the live item is always cleared even across re-renders.
 */
export interface MeetingRecordingHook {
  /** Toggle recording: start when idle, stop when recording. */
  toggleRecording: () => Promise<void>;
  isRecording: boolean;
  elapsedTime: number;
}

export function useMeetingRecording(): MeetingRecordingHook {
  const { startRecording, stopRecording, isRecording, elapsedTime } = useRecording();
  const addRecordingItem = useActivityStore((s) => s.addRecordingItem);
  const removeRecordingItem = useActivityStore((s) => s.removeRecordingItem);

  // Stable id for the live recording activity item, set on start, cleared on stop.
  const recordingItemIdRef = useRef<string | null>(null);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      const result = await stopRecording();
      const itemId = recordingItemIdRef.current;
      if (itemId) {
        removeRecordingItem(itemId);
        recordingItemIdRef.current = null;
      }
      if (result?.path) {
        startTranscription({ audioPath: result.path });
      }
    } else {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `recording-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      recordingItemIdRef.current = id;
      addRecordingItem({ id, label: "Recording", recordingStartedAt: Date.now() });
      try {
        await startRecording("microphone");
      } catch (err) {
        // Capture never began — remove the live activity item so the orb doesn't
        // show a stuck "Recording" indicator, clear the ref, and surface the error.
        removeRecordingItem(id);
        recordingItemIdRef.current = null;
        toast.error(
          `Could not start recording: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }, [isRecording, startRecording, stopRecording, addRecordingItem, removeRecordingItem]);

  return { toggleRecording, isRecording, elapsedTime };
}
