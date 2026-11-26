import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Mic, Square } from "lucide-react";
import { useMeetingRecording } from "@/hooks/useMeetingRecording";
import { recordingSourceLabel } from "@/hooks/useRecording";
import { useRecordingStore } from "@/stores/recording-store";
import { t } from "@/lib/i18n";
import { useLocale } from "@/lib/useLocale";
import { log } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MicButton({
  editor,
  showTooltip = true,
}: {
  editor: Editor | null;
  /**
   * When `false`, the button renders without its hover/focus tooltip.
   * Used by the StatusTray popover (live-test 2026-04-25) where the
   * popover already labels each control with adjacent text — Radix's
   * focus-triggered tooltip would auto-open on every popover open
   * because the popover lands initial focus on MicButton.
   */
  showTooltip?: boolean;
}) {
  // Meeting recording (not dictation): click starts a mic recording, click
  // again stops it and kicks off the background transcription job. See
  // `useMeetingRecording` for the full start → record → transcribe flow.
  const { toggleRecording, isRecording, isPaused, phase } = useMeetingRecording();
  // `t()` reads module state — subscribe so a language change repaints this.
  useLocale();
  const nextSource = useRecordingStore((s) => s.lastUsedSource);
  const busy = phase === "starting" || phase === "stopping";

  const handleToggle = useCallback(() => {
    void toggleRecording().catch((err) => log.warn("recording", "Toggle recording failed", err));
  }, [toggleRecording]);

  const label = isRecording
    ? isPaused
      ? t("recording.stopAndSavePaused")
      : t("recording.stopAndSave")
    : t("recording.startWith", { source: recordingSourceLabel(nextSource) });

  const button = (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleToggle}
      disabled={!editor || busy}
      aria-label={label}
      aria-pressed={isRecording}
      className={cn(
        "active:scale-90",
        // Red while recording, like the indicator: the accent colour used
        // here before is grey in the default theme, which made a live
        // microphone look idle. `animate-pulse` marks "capturing now" and
        // stops while PAUSED, mirroring the frozen timer.
        isRecording && !isPaused
          ? "animate-pulse motion-reduce:animate-none text-[var(--color-destructive)]"
          : isRecording
            ? "text-[var(--color-destructive)]"
            : "text-muted-foreground",
      )}
    >
      {isRecording ? (
        // A stop square, not a struck-through microphone: `MicOff` reads as
        // "muted", the opposite of what is happening.
        <Square className="size-3.5 fill-current" strokeWidth={1.5} />
      ) : (
        <Mic className="size-4" strokeWidth={1.5} />
      )}
    </Button>
  );

  if (!showTooltip) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
