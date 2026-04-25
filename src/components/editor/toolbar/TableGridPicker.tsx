import { useState } from "react";
import type { Editor } from "@tiptap/react";
import { Table } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const TABLE_GRID_MAX_ROWS = 8;
const TABLE_GRID_MAX_COLS = 8;

export function TableGridPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [hoverRows, setHoverRows] = useState(0);
  const [hoverCols, setHoverCols] = useState(0);

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
                (open || editor.isActive("table")) && "bg-[var(--color-accent-primary)]/12 text-foreground"
              )}
            >
              <Table className="size-4" strokeWidth={1.5} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Insert table
        </TooltipContent>
      </Tooltip>
      <PopoverContent
        side="bottom"
        align="start"
        className="w-auto p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div
          className="grid gap-[3px]"
          style={{ gridTemplateColumns: `repeat(${TABLE_GRID_MAX_COLS}, 1fr)` }}
          onMouseLeave={() => { setHoverRows(0); setHoverCols(0); }}
        >
          {Array.from({ length: TABLE_GRID_MAX_ROWS }, (_, row) =>
            Array.from({ length: TABLE_GRID_MAX_COLS }, (_, col) => {
              const isHighlighted = row < hoverRows && col < hoverCols;
              return (
                <button
                  key={`${row}-${col}`}
                  className={cn(
                    "size-4 rounded-[2px] border transition-colors duration-75",
                    isHighlighted
                      ? "border-foreground/40 bg-foreground/15"
                      : "border-border bg-transparent hover:border-muted-foreground/30"
                  )}
                  onMouseEnter={() => { setHoverRows(row + 1); setHoverCols(col + 1); }}
                  onClick={() => {
                    editor
                      .chain()
                      .focus()
                      .insertTable({ rows: row + 1, cols: col + 1, withHeaderRow: true })
                      .run();
                    setOpen(false);
                    setHoverRows(0);
                    setHoverCols(0);
                  }}
                />
              );
            })
          )}
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-1.5 tabular-nums">
          {hoverRows > 0 ? `${hoverRows} × ${hoverCols}` : "Select size"}
        </p>
      </PopoverContent>
    </Popover>
  );
}
