import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Settings2 } from "lucide-react";
import { TableToolbarContent } from "../TableToolbar";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function TableToolsPopover({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              className={cn(
                "text-muted-foreground",
                open && "bg-[var(--color-accent-primary)] text-[oklch(100%_0_0)]"
              )}
            >
              <Settings2 className="size-3.5" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Table tools
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto p-0 rounded-lg border border-border bg-popover shadow-lg backdrop-blur-sm"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <TableToolbarContent editor={editor} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
