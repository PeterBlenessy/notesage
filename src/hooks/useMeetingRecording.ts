import { useCallback } from "react";
import { toast } from "sonner";
import { useRecording } from "@/hooks/useRecording";
import { useRecordingStore } from "@/stores/recording-store";
import { useActivityStore } from "@/stores/activity-store";
import { startTranscription } from "@/hooks/useTranscriptionJob";
import { track } from "@/lib/telemetry";
import { tauriApi, type RecordingResult } from "@/lib/tauri";
import { appVersion } from "@/lib/version";
import { basename, dirname, writeRecordingManifest } from "@/lib/transcription/bundle";
import { createMacRecordingManifest } from "@/lib/transcription/manifest";
import { log } from "@/lib/logger";

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
 * The live recording activity-item id is MODULE-scoped, not component-scoped:
 * the hook is instantiated by several surfaces (StatusTray popover MicButton,
 * pill-toolbar MicButton, the orb's RecordingControl), and the popover instances
 * unmount whenever the popover closes. A `useRef` id would be lost on
 * unmount — stopping from a different (or remounted) instance then leaked the
 * orb's "Recording" indicator forever (#stuck-orb). Only one recording can
 * exist at a time (the backend enforces a single capture owner), so a module
 * singleton is the correct scope.
 */
let liveRecordingItemId: string | null = null;

/** Test-only: reset the module-scoped live recording item id. */
export function __resetLiveRecordingItemId(): void {
  liveRecordingItemId = null;
}

/**
 * Write `recording.json` into the Mac's own bundle after `stop_recording`, so
 * the format is bilateral: the scanner treats a Mac bundle and a phone bundle
 * by one rule, and a phone can show a Mac recording with its duration (PRD
 * `2026-09-05-ios-recordings`, task #13). `bytes` is the finalized WAV's size
 * on disk — the same partial-download gate the phone's manifest carries.
 *
 * Best-effort: a failure here is logged and never blocks the transcription
 * that follows — the bundle simply looks like a pre-manifest Mac bundle.
 */
export async function writeMacRecordingManifest(
  result: RecordingResult,
  startedAtMs: number | undefined,
  language: string | undefined,
): Promise<void> {
  try {
    const [bytes, device] = await Promise.all([
      tauriApi.fileSize(result.path),
      tauriApi.getDeviceName().catch(() => "Mac"),
    ]);
    const manifest = createMacRecordingManifest({
      startedAtMs: startedAtMs ?? Date.now() - result.duration_secs * 1000,
      durationSecs: result.duration_secs,
      bytes,
      sampleRate: result.sample_rate,
      audioFile: basename(result.path),
      device,
      appVersion: appVersion(),
      language,
    });
    await writeRecordingManifest(dirname(result.path), manifest);
  } catch (err) {
    log.warn("recording", "Could not write recording.json for the finished bundle", err);
  }
}

export interface MeetingRecordingHook {
  /** Toggle recording: start when idle, stop when recording (paused or not). */
  toggleRecording: () => Promise<void>;
  /** Pause the live capture (stream stays alive, samples discarded). */
  pauseRecording: () => Promise<void>;
  /** Resume a paused capture. */
  resumeRecording: () => Promise<void>;
  isRecording: boolean;
  isPaused: boolean;
  /** Recorded seconds — pause-aware (frozen while paused). */
  elapsedTime: number;
}

export function useMeetingRecording(): MeetingRecordingHook {
  const {
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    isRecording,
    isPaused,
    elapsedTime,
  } = useRecording();
  const addRecordingItem = useActivityStore((s) => s.addRecordingItem);
  const removeRecordingItem = useActivityStore((s) => s.removeRecordingItem);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      // Capture the start time BEFORE stopping — `stopRecording` clears
      // `recordingStartTime` from the store as part of teardown.
      const startedAt = useRecordingStore.getState().recordingStartTime ?? undefined;
      const result = await stopRecording();
      const itemId = liveRecordingItemId;
      // Capture the recording item's per-recording language override (if the
      // user picked one on the orb card) BEFORE removing the item — once
      // removed, its `language` field is gone from the store.
      const language = itemId
        ? useActivityStore.getState().tasks.find((t) => t.id === itemId)?.language
        : undefined;
      if (itemId) {
        removeRecordingItem(itemId);
        liveRecordingItemId = null;
      }
      if (result?.path) {
        // The manifest goes in BEFORE the job is dispatched, so the scanner's
        // create event for it finds the bundle already tracked by audioPath.
        await writeMacRecordingManifest(result, startedAt, language);
        startTranscription({
          audioPath: result.path,
          recordingStartedAt: startedAt,
          recordingStoppedAt: Date.now(),
          recordingDurationSecs: result.duration_secs,
          language,
        });
      }
    } else {
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `recording-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      liveRecordingItemId = id;
      addRecordingItem({ id, label: "Recording", recordingStartedAt: Date.now() });
      try {
        await startRecording("microphone");
        // `useRecording.startRecording` swallows backend errors (it toasts and
        // returns normally), so a resolved promise does NOT mean capture began.
        // The store flag is only set on success — if it's still false, the
        // start failed and the live item must be cleared or the orb shows a
        // stuck "Recording" indicator.
        if (!useRecordingStore.getState().isRecording) {
          removeRecordingItem(id);
          liveRecordingItemId = null;
          return;
        }
        track("feature_used", { feature: "recording" });
      } catch (err) {
        // Capture never began — remove the live activity item so the orb doesn't
        // show a stuck "Recording" indicator, clear the id, and surface the error.
        removeRecordingItem(id);
        liveRecordingItemId = null;
        toast.error(
          `Could not start recording: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }, [isRecording, startRecording, stopRecording, addRecordingItem, removeRecordingItem]);

  return { toggleRecording, pauseRecording, resumeRecording, isRecording, isPaused, elapsedTime };
}
