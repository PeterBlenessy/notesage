import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshCw, Check, X } from "lucide-react";
import type { ExternalChangeEntry } from "@/stores/external-change-store";

interface ChangeListPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  changes: ExternalChangeEntry[];
  /** File path of the currently focused editor tab */
  activeFilePath: string | null;
  onSelectChange: (change: ExternalChangeEntry, hunkIndex: number) => void;
  onAcceptAll?: () => void;
  onRejectAll?: () => void;
  /** Accept a single hunk by ID (only works for the focused file) */
  onAcceptHunk?: (hunkId: string) => void;
  /** Reject a single hunk by ID (only works for the focused file) */
  onRejectHunk?: (hunkId: string) => void;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen).trimEnd() + "\u2026";
}

/** Compact change preview: shows delete and/or insert text inline */
function ChangePreview({ deleteText, insertText }: { deleteText: string; insertText: string }) {
  if (deleteText && insertText) {
    return (
      <span className="flex items-center gap-1 min-w-0 truncate">
        <span className="text-red-500 line-through truncate">{truncate(deleteText, 20)}</span>
        <span className="text-green-600 truncate">{truncate(insertText, 20)}</span>
      </span>
    );
  }
  if (deleteText) {
    return <span className="text-red-500 line-through truncate">{truncate(deleteText, 30)}</span>;
  }
  if (insertText) {
    return <span className="text-green-600 truncate">{truncate(insertText, 30)}</span>;
  }
  return <span className="text-muted-foreground italic">empty</span>;
}

export function ChangeListPopover({
  open,
  onOpenChange,
  changes,
  activeFilePath,
  onSelectChange,
  onAcceptAll,
  onRejectAll,
  onAcceptHunk,
  onRejectHunk,
}: ChangeListPopoverProps) {
  const sorted = [...changes].sort((a, b) => b.timestamp - a.timestamp);
  const totalHunks = changes.reduce(
    (sum, c) => sum + c.hunks.filter(h => h.deleteText || h.insertText).length, 0
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded px-0.5 hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
          <span>{totalHunks}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-96 p-0 max-h-80 overflow-y-auto"
      >
        {/* Header */}
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-xs font-medium text-foreground">
            Pending Changes ({totalHunks})
          </span>
          {totalHunks > 0 && onAcceptAll && onRejectAll && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
                onClick={() => { onRejectAll(); onOpenChange(false); }}
              >
                <X className="h-3 w-3" strokeWidth={1.5} />
                Reject All
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded hover:bg-muted transition-colors text-foreground font-medium"
                onClick={() => { onAcceptAll(); onOpenChange(false); }}
              >
                <Check className="h-3 w-3" strokeWidth={1.5} />
                Accept All
              </button>
            </div>
          )}
        </div>

        {/* Body */}
        {totalHunks === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            No pending changes
          </div>
        ) : (
          <div className="py-1">
            {sorted.map((change) => {
              const isActive = change.filePath === activeFilePath;
              const visibleHunks = change.hunks.filter(h => h.deleteText || h.insertText);

              return visibleHunks.map((hunk, hunkIdx) => (
                <div
                  key={hunk.id}
                  className="group flex items-center gap-2 px-3 py-1.5 hover:bg-muted transition-colors"
                >
                  {/* Clickable area: filename + change preview — navigates to hunk */}
                  <button
                    type="button"
                    onClick={() => onSelectChange(change, hunkIdx)}
                    className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-xs leading-snug focus-visible:outline-none focus-visible:bg-muted"
                  >
                    <TooltipProvider delayDuration={400}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-muted-foreground shrink-0 max-w-[80px] truncate">
                            {change.fileName}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left" className="text-xs">
                          {change.filePath}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <span className="text-muted-foreground/50 shrink-0">:</span>
                    <ChangePreview deleteText={hunk.deleteText} insertText={hunk.insertText} />
                  </button>

                  {/* Per-hunk accept/reject — only functional for the focused file */}
                  {isActive && onAcceptHunk && onRejectHunk && (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-green-600"
                        onClick={(e) => { e.stopPropagation(); onAcceptHunk(hunk.id); }}
                        title="Accept change"
                      >
                        <Check className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-red-500"
                        onClick={(e) => { e.stopPropagation(); onRejectHunk(hunk.id); }}
                        title="Reject change"
                      >
                        <X className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
              ));
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
