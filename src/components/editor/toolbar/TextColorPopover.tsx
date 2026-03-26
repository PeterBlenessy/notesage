import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Baseline, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const TEXT_COLORS = [
  { label: "Default", value: null },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Yellow", value: "#eab308" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Purple", value: "#a855f7" },
  { label: "Grey", value: "#6b7280" },
] as const;

export function TextColorPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  // Get current text color from editor
  const currentColor = editor.getAttributes("textStyle")?.color as string | undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground relative"
            >
              <Baseline className="size-4" strokeWidth={1.5} />
              <span
                className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 w-3 rounded-full"
                style={{ backgroundColor: currentColor || "currentColor" }}
              />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Text color
        </TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="start" className="w-[180px] p-2">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5 px-1">
          Text Color
        </p>
        <div className="grid grid-cols-8 gap-1">
          {TEXT_COLORS.map(({ label, value }) => (
            <Tooltip key={label}>
              <TooltipTrigger asChild>
                <button
                  className={cn(
                    "size-5 rounded-full border border-border transition-transform hover:scale-125 focus:outline-none focus:ring-1 focus:ring-ring",
                    !value && "flex items-center justify-center",
                    currentColor === value && "ring-1 ring-foreground ring-offset-1 ring-offset-background"
                  )}
                  style={value ? { backgroundColor: value } : undefined}
                  onClick={() => {
                    if (value) {
                      editor.chain().focus().setColor(value).run();
                    } else {
                      editor.chain().focus().unsetColor().run();
                    }
                    setOpen(false);
                  }}
                >
                  {!value && <X className="size-3 text-muted-foreground" strokeWidth={1.5} />}
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
