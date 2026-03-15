import { useState, useEffect, useCallback } from "react";
import { RecordingBar } from "@/components/recording/RecordingBar";
import { TranscriptionDialog } from "@/components/recording/TranscriptionDialog";
import { useRecording } from "@/hooks/useRecording";
import type { AudioBufferInfo } from "@/lib/tauri";

interface TranscriptionOverlayProps {
  /** Project path for saving transcription as a note */
  projectPath: string | null;
  /** Insert transcribed text at cursor position in the editor */
  onInsertAtCursor?: (text: string) => void;
}

/**
 * Manages recording UI (RecordingBar) and the transcription dialog.
 * Listens for the global `notesage:toggle-recording` event (Cmd+Shift+R).
 */
export function TranscriptionOverlay({ projectPath, onInsertAtCursor }: TranscriptionOverlayProps) {
  const recording = useRecording();
  const [transcriptionDialogOpen, setTranscriptionDialogOpen] = useState(false);
  const [lastBufferInfo, setLastBufferInfo] = useState<AudioBufferInfo | null>(null);

  // Toggle recording via global keyboard shortcut event
  useEffect(() => {
    const handleToggleRecording = () => {
      if (recording.isRecording) {
        recording.stopRecording().then((info) => {
          if (info) {
            setLastBufferInfo(info);
            setTranscriptionDialogOpen(true);
          }
        });
      } else {
        recording.startRecording("microphone");
      }
    };
    window.addEventListener("notesage:toggle-recording", handleToggleRecording);
    return () => window.removeEventListener("notesage:toggle-recording", handleToggleRecording);
  }, [recording]);

  const handleStop = useCallback(async () => {
    const info = await recording.stopRecording();
    if (info) {
      setLastBufferInfo(info);
      setTranscriptionDialogOpen(true);
    }
  }, [recording]);

  const handleSaveAsNote = useCallback(async (content: string, title: string) => {
    if (projectPath) {
      const fileName = `${title.replace(/[^a-zA-Z0-9 —-]/g, '').replace(/ /g, '-').toLowerCase()}.md`;
      const filePath = `${projectPath}/${fileName}`;
      try {
        const { tauriApi: api } = await import('@/lib/tauri');
        await api.writeFile(filePath, content);
        const { toast } = await import('sonner');
        toast.success(`Saved: ${fileName}`);
      } catch (err) {
        const { toast } = await import('sonner');
        toast.error(`Failed to save: ${err}`);
      }
    }
  }, [projectPath]);

  return (
    <>
      {recording.isRecording && (
        <RecordingBar
          elapsedTime={recording.elapsedTime}
          source={recording.source}
          micLevel={recording.micLevel}
          onStop={handleStop}
        />
      )}
      <TranscriptionDialog
        open={transcriptionDialogOpen}
        onOpenChange={setTranscriptionDialogOpen}
        bufferInfo={lastBufferInfo}
        onSaveAsNote={handleSaveAsNote}
        onInsertAtCursor={onInsertAtCursor}
      />
    </>
  );
}
