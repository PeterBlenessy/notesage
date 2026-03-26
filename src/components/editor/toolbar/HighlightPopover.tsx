import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Highlighter, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const HIGHLIGHT_COLORS = [
  { label: "None", name: null, swatch: "var(--color-background)" },
  { label: "Yellow", name: "yellow", swatch: "var(--color-highlight-yellow)" },
  { label: "Green", name: "green", swatch: "var(--color-highlight-green)" },
  { label: "Blue", name: "blue", swatch: "var(--color-highlight-blue)" },
  { label: "Pink", name: "pink", swatch: "var(--color-highlight-pink)" },
  { label: "Orange", name: "orange", swatch: "var(--color-highlight-orange)" },
  { label: "Grey", name: "grey", swatch: "var(--color-highlight-grey)" },
] as const;

export function HighlightPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  const currentHighlight = editor.getAttributes("highlight")?.color as string | undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "text-muted-foreground relative",
                currentHighlight && "text-foreground"
              )}
            >
              <Highlighter className="size-4" strokeWidth={1.5} />
              {currentHighlight && (
                <span
                  className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full highlight-swatch-indicator"
                  data-color={currentHighlight}
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Highlight
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-[180px] p-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
          Highlight
        </p>
        <div className="grid grid-cols-7 gap-1">
          {HIGHLIGHT_COLORS.map(({ label, name, swatch }) => (
              <Tooltip key={label}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      "size-5 rounded border border-border transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-ring",
                      !name && "flex items-center justify-center",
                      currentHighlight === name && "ring-1 ring-foreground ring-offset-1 ring-offset-background"
                    )}
                    style={{ backgroundColor: swatch }}
                    onClick={() => {
                      if (name) {
                        editor.chain().focus().toggleHighlight({ color: name }).run();
                      } else {
                        editor.chain().focus().unsetHighlight().run();
                      }
                      setOpen(false);
                    }}
                  >
                    {!name && <X className="size-3 text-muted-foreground" strokeWidth={1.5} />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  {label}
                </TooltipContent>
              </Tooltip>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
