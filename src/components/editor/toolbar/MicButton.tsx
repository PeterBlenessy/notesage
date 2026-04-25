import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { Mic, MicOff } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
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
  const { startDictation, stopDictation, isDictating, finalText } = useSpeechRecognition();
  const prevFinalTextRef = useRef(finalText);

  // Insert final dictation text at cursor
  useEffect(() => {
    if (finalText && finalText !== prevFinalTextRef.current && editor) {
      editor.chain().focus().insertContent(finalText).run();
    }
    prevFinalTextRef.current = finalText;
  }, [finalText, editor]);

  const handleToggle = useCallback(async () => {
    if (isDictating) {
      await stopDictation();
    } else {
      await startDictation();
    }
  }, [isDictating, startDictation, stopDictation]);

  const label = isDictating ? "Stop dictation" : "Start dictation";

  const button = (
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={handleToggle}
      disabled={!editor}
      aria-label={label}
      aria-pressed={isDictating}
      className={cn(
        "active:scale-90",
        // Live-test 2026-04-25 — use the user's accent colour while
        // dictating instead of hardcoded red. Falls back to
        // --color-primary (neutral grey) when no accent is selected,
        // so existing users see no chromatic surprise. The icon also
        // keeps `animate-pulse` to make the "recording" state
        // unmistakable. A separate Recording row in the StatusTray
        // popover used to convey this state textually — that row was
        // removed because the icon now communicates it on its own.
        isDictating
          ? "animate-pulse text-[var(--color-accent-primary)]"
          : "text-muted-foreground",
      )}
    >
      {isDictating ? (
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
