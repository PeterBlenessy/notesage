import { toast } from "sonner";
import { log } from "@/lib/logger";
import {
  iosContextMenu,
  iosOpenSettings,
  iosRecordingPause,
  iosRecordingRecover,
  iosRecordingResume,
  iosRecordingStart,
  iosRecordingState,
  iosRecordingStop,
  onIosRecordingEvent,
} from "@/lib/ios-api";
import { t } from "@/lib/i18n";
import { useMobileStore } from "@/stores/mobile-store";
import { stopSpeech } from "@/lib/speech-controller";

/**
 * The recorder belongs to the app, not to a screen: it keeps running while
 * the user browses or reads, like the read-aloud session. Native events
 * feed `mobile-store.recording`; these functions are the transport.
 */
export function startRecordingEvents(): () => void {
  return onIosRecordingEvent((event) => {
    const store = useMobileStore.getState();
    switch (event.event) {
      case "started":
        store.setRecording({ status: "recording", startedAt: Date.now(), elapsedSecs: 0, level: 0, interrupted: false });
        return;
      case "tick":
        store.setRecording({ elapsedSecs: event.elapsedSecs, level: event.level });
        return;
      case "paused":
        store.setRecording({ status: "paused", level: 0 });
        return;
      case "resumed":
        store.setRecording({ status: "recording", interrupted: false });
        return;
      case "interrupted":
        // Began: paused by the system. Ended without a resume: still paused,
        // and the island says why.
        store.setRecording({ status: "paused", interrupted: true, level: 0 });
        return;
      case "route":
        // Kept recording on the new route; nothing to change.
        return;
      case "finished":
        store.setRecording({ ...IDLE, micPermission: store.recording.micPermission });
        return;
      case "error":
        toast.error(t("recording.failed", { error: event.message }));
        return;
    }
  });
}

const IDLE = { status: "idle" as const, startedAt: null, elapsedSecs: 0, level: 0, interrupted: false, orphan: null };

/** Ask the native recorder where things stand (launch, foreground). */
export async function syncRecordingState(): Promise<void> {
  try {
    const s = await iosRecordingState();
    useMobileStore.getState().setRecording({
      status: s.status,
      elapsedSecs: s.elapsedSecs,
      level: s.level,
      interrupted: s.interrupted,
      micPermission: s.micPermission,
      orphan: s.orphan ?? null,
    });
  } catch {
    // No native side (desktop dev, tests).
  }
}

export async function startRecording(language?: string | null): Promise<void> {
  const store = useMobileStore.getState();
  if (store.recording.status !== "idle") return;
  // One owner of the audio session: a running article stops first.
  if (store.speech) stopSpeech();
  try {
    // The lock screen and Control Center show this while the app is away.
    await iosRecordingStart(language, {
      title: t("recording.nowPlaying"),
      subtitle: t("recording.nowPlayingHint"),
    });
    // The `started` event follows; set the status now so the island shows
    // before the first tick.
    store.setRecording({ status: "recording", startedAt: Date.now(), elapsedSecs: 0, level: 0, interrupted: false, micPermission: "granted" });
  } catch (err) {
    const message = String(err);
    log.error("recording", `start failed: ${message}`);
    if (message.includes("microphone-denied")) {
      store.setRecording({ micPermission: "denied" });
      toast.error(t("recording.micDenied"), {
        action: { label: t("recording.openSettings"), onClick: () => void iosOpenSettings().catch(() => {}) },
      });
    } else if (message.includes("low-disk-space")) {
      toast.error(t("recording.lowDisk"));
    } else {
      toast.error(t("recording.failed", { error: message }));
    }
  }
}

export function pauseRecording(): void {
  void iosRecordingPause().catch(() => {});
}

export function resumeRecording(): void {
  void iosRecordingResume().catch(() => {});
}

/** Under five seconds is a slip of the finger: ask before keeping nothing. */
export const DISCARD_UNDER_SECS = 5;

/**
 * The discard question, asked natively.
 *
 * It lives HERE rather than at the call site because it used to live at one
 * call site only: the browser passed it, the Reader did not, and since the
 * recorder deliberately keeps running while an article is open, stopping from
 * the Reader silently saved every accidental two-second recording instead of
 * offering to throw it away. A default no caller can forget is the fix.
 */
async function askWhetherToDiscard(): Promise<boolean> {
  try {
    const chosen = await iosContextMenu({
      title: t("recording.discardTitle"),
      items: [
        { id: "discard", title: t("recording.discard"), destructive: true },
        { id: "keep", title: t("recording.keep") },
      ],
    });
    return chosen === "discard";
  } catch {
    return window.confirm(t("recording.discardTitle"));
  }
}

export async function stopRecording(options: { confirmDiscard?: () => Promise<boolean> } = {}): Promise<string | null> {
  const store = useMobileStore.getState();
  if (store.recording.status === "idle") return null;
  let discard = false;
  if (store.recording.elapsedSecs < DISCARD_UNDER_SECS) {
    discard = await (options.confirmDiscard ?? askWhetherToDiscard)();
  }
  store.setRecording({ status: "finalizing" });
  try {
    const { relPath } = await iosRecordingStop(discard);
    store.setRecording({ ...IDLE, micPermission: store.recording.micPermission });
    if (relPath) toast.success(t("recording.saved"));
    return relPath;
  } catch (err) {
    store.setRecording({ ...IDLE, micPermission: store.recording.micPermission });
    toast.error(t("recording.failed", { error: String(err) }));
    return null;
  }
}

/** Keep or discard what a force-quit left behind. */
export async function recoverRecording(action: "keep" | "discard"): Promise<string | null> {
  const store = useMobileStore.getState();
  const orphan = store.recording.orphan;
  if (!orphan) return null;
  try {
    const relPath = await iosRecordingRecover(action, orphan.dir);
    store.setRecording({ orphan: null });
    if (relPath) toast.success(t("recording.saved"));
    return relPath;
  } catch (err) {
    toast.error(t("recording.failed", { error: String(err) }));
    return null;
  }
}

/** "02:14" — pause-aware seconds from the native tick. */
export function formatElapsed(secs: number): string {
  const total = Math.max(0, Math.floor(secs));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The island's spec, or `undefined` when nothing is recording. */
export function recorderChromeSpec(): import("@/lib/ios-api").IosChromeRecorder | undefined {
  const r = useMobileStore.getState().recording;
  if (r.status === "idle") return undefined;
  return {
    elapsed: formatElapsed(r.elapsedSecs),
    paused: r.status === "paused" || r.status === "finalizing",
    level: r.level,
    interrupted: r.interrupted,
    interruptedLabel: t("recording.interrupted"),
  };
}
