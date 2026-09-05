import { Pause, Play, Square } from "lucide-react";
import { formatElapsed, pauseRecording, resumeRecording } from "@/lib/recording-controller";
import { t } from "@/lib/i18n";
import { useMobileStore } from "@/stores/mobile-store";
import { Island } from "./Chrome";

/**
 * The recording island's web fallback (desktop dev, tests, builds without
 * the native layer): red dot, elapsed, pause/resume, stop. Native builds
 * draw the same thing as a glass island over the webview.
 */
export function RecordingBar({ onStop }: { onStop: () => void }) {
  const recording = useMobileStore((s) => s.recording);
  if (recording.status === "idle") return null;
  const paused = recording.status !== "recording";
  return (
    <Island corner="bottom-center">
      <div className="flex items-center gap-3 px-3 py-1" role="group" aria-label={t("recording.inProgress")}>
        <span className={`h-3 w-3 rounded-full bg-destructive ${paused ? "opacity-40" : ""}`} aria-hidden />
        <span className="min-w-[3.5rem] text-sm tabular-nums">
          {recording.interrupted && paused ? t("recording.interrupted") : formatElapsed(recording.elapsedSecs)}
        </span>
        <button
          type="button"
          className="ios-press-row flex h-10 w-10 items-center justify-center rounded-full"
          aria-label={paused ? t("reader.listenResume") : t("reader.listenPause")}
          onClick={() => (paused ? resumeRecording() : pauseRecording())}
        >
          {paused ? <Play strokeWidth={1.5} className="h-5 w-5" /> : <Pause strokeWidth={1.5} className="h-5 w-5" />}
        </button>
        <button
          type="button"
          className="ios-press-row flex h-10 w-10 items-center justify-center rounded-full"
          aria-label={t("reader.listenStop")}
          onClick={onStop}
        >
          <Square strokeWidth={1.5} className="h-4 w-4" />
        </button>
      </div>
    </Island>
  );
}
