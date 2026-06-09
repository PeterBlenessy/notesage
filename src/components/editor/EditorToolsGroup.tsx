import { FileCode, FileText } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ViewMode } from "@/lib/file-utils";
import { MicButton } from "./toolbar/MicButton";

export function EditorToolsGroup({
  editor,
  viewMode,
  onToggleViewMode,
}: {
  editor: Editor | null;
  viewMode?: ViewMode;
  onToggleViewMode?: () => void;
}) {
  const showSourceToggle = Boolean(onToggleViewMode);
  const showMic = Boolean(editor);
  if (!showMic && !showSourceToggle) return null;

  const isSource = viewMode === "source";

  return (
    <section className="flex items-center gap-2" aria-label="Editor tools">
      {showMic && <MicButton editor={editor ?? null} />}
      {showSourceToggle && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              role="switch"
              aria-checked={isSource}
              aria-label={
                isSource ? "Switch to Rich text" : "Switch to Markdown source"
              }
              onClick={onToggleViewMode}
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 h-7 px-2 rounded-sm border border-border",
                "text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50",
                "transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
            >
              {isSource ? (
                <>
                  <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span>Source</span>
                </>
              ) : (
                <>
                  <FileCode className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                  <span>WYSIWYG</span>
                </>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-[220px]">
            {isSource ? "Rich text" : "Markdown source"}
          </TooltipContent>
        </Tooltip>
      )}
    </section>
  );
}
