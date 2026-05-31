import { useCallback } from "react";
import type { Editor } from "@tiptap/react";
import { Mic, MicOff } from "lucide-react";
import { useMeetingRecording } from "@/hooks/useMeetingRecording";
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
  const { toggleRecording, isRecording } = useMeetingRecording();

  const handleToggle = useCallback(async () => {
    await toggleRecording();
  }, [toggleRecording]);

  const label = isRecording ? "Stop recording" : "Start recording";

  const button = (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleToggle}
      disabled={!editor}
      aria-label={label}
      aria-pressed={isRecording}
      className={cn(
        "active:scale-90",
        // Live-test 2026-04-25 — use the user's accent colour while
        // recording instead of hardcoded red. Falls back to
        // --color-primary (neutral grey) when no accent is selected,
        // so existing users see no chromatic surprise. The icon also
        // keeps `animate-pulse` to make the "recording" state
        // unmistakable.
        isRecording
          ? "animate-pulse text-[var(--color-accent-primary)]"
          : "text-muted-foreground",
      )}
    >
      {isRecording ? (
        <MicOff className="size-4" strokeWidth={1.5} />
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
