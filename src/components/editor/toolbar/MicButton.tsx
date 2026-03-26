import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "@tiptap/react";
import { Mic, MicOff } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function MicButton({ editor }: { editor: Editor | null }) {
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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={handleToggle}
          disabled={!editor}
          className={cn(
            "active:scale-90",
            isDictating
              ? "text-red-500 animate-pulse"
              : "text-muted-foreground"
          )}
        >
          {isDictating ? (
            <MicOff className="size-4" strokeWidth={1.5} />
          ) : (
            <Mic className="size-4" strokeWidth={1.5} />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {isDictating ? "Stop dictation" : "Start dictation"}
      </TooltipContent>
    </Tooltip>
  );
}
