import { useEffect, useCallback } from "react";
import { RecordingBar } from "@/components/recording/RecordingBar";
import { useRecording } from "@/hooks/useRecording";
import { useMeetingRecording } from "@/hooks/useMeetingRecording";

interface TranscriptionOverlayProps {
  /**
   * Project path — retained for call-site compatibility. The transcript now
   * lands in the global `~/Notesage` recordings inbox and is moved to a
   * project from the AgentOrb panel after transcription completes, so this
   * is no longer read here.
   */
  projectPath?: string | null;
  /**
   * Retained for call-site compatibility. Meeting recording no longer
   * inserts transcribed text at the cursor — the transcript becomes a note.
   */
  onInsertAtCursor?: (text: string) => void;
}

/**
 * Hosts the live recording indicator (RecordingBar) and wires the global
 * `notesage:toggle-recording` event (⌘⇧R) to meeting recording.
 *
 * Recording is capture-only: starting/stopping is delegated to
 * `useMeetingRecording`, which on stop fires the background transcription
 * job (surfaced through the AgentOrb). There is no synchronous transcription
 * dialog and no dictation — both were removed with the voice-subsystem
 * rewrite (PRD 2026-05-30-meeting-recording).
 */
export function TranscriptionOverlay(_props: TranscriptionOverlayProps) {
  const recording = useRecording();
  const { toggleRecording } = useMeetingRecording();

  // Toggle meeting recording via the global ⌘⇧R event.
  useEffect(() => {
    const handleToggleRecording = () => {
      void toggleRecording();
    };
    window.addEventListener("notesage:toggle-recording", handleToggleRecording);
    return () =>
      window.removeEventListener("notesage:toggle-recording", handleToggleRecording);
  }, [toggleRecording]);

  const handleStop = useCallback(() => {
    void toggleRecording();
  }, [toggleRecording]);

  if (!recording.isRecording) return null;

  return (
    <RecordingBar
      elapsedTime={recording.elapsedTime}
      source={recording.source}
      micLevel={recording.micLevel}
      onStop={handleStop}
    />
  );
}
