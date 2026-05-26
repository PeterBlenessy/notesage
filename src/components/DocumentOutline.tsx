import { useMemo, useCallback } from "react";
import { List } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Editor } from "@tiptap/core";

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

interface DocumentOutlineProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editor: Editor | null;
}

export function DocumentOutline({ open, onOpenChange, editor }: DocumentOutlineProps) {
  const headings = useMemo(() => {
    if (!editor) return [];
    const items: HeadingItem[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading") {
        items.push({
          level: node.attrs.level as number,
          text: node.textContent,
          pos,
        });
      }
    });
    return items;
  }, [editor, open]); // Re-compute when dialog opens

  const handleSelect = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    if (!editor) return;
    const pos = Number(e.currentTarget.dataset.pos);
    if (Number.isNaN(pos)) return;
    onOpenChange(false);
    // Use double-RAF to ensure dialog close re-render has settled
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          // Get the DOM element at the heading position
          const domInfo = editor.view.domAtPos(pos + 1);
          const el: Element | null = domInfo.node instanceof Element
            ? domInfo.node
            : domInfo.node.parentElement;
          if (el) {
            el.scrollIntoView({ block: "center", behavior: "instant" });
          }
        } catch {
          // Position not in DOM
        }
        // Set selection after scroll so the browser doesn't fight us
        editor.commands.setTextSelection(pos + 1);
        editor.commands.focus();
      });
    });
  }, [editor, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Document Outline</DialogTitle>
        <DialogDescription>Navigate to headings in the document</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" showCloseButton={false}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-border">
          <List className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-sm font-medium text-foreground">
            Document Outline
          </span>
          <span className="text-xs ml-auto text-muted-foreground">
            {headings.length} {headings.length === 1 ? "heading" : "headings"}
          </span>
        </div>

        {/* Heading list */}
        <div className="max-h-[360px] overflow-y-auto py-1">
          {headings.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No headings in this document
              </p>
            </div>
          ) : (
            headings.map((heading, index) => (
                <button
                  key={`${heading.pos}-${index}`}
                  data-pos={heading.pos}
                  onClick={handleSelect}
                  className="w-[calc(100%-8px)] text-left py-1.5 pr-3 flex items-center gap-2 transition-colors duration-150 mx-1 rounded-md hover:bg-accent"
                  style={{ paddingLeft: `${12 + (heading.level - 1) * 16}px` } as React.CSSProperties}
                >
                  <span className="text-xs font-mono shrink-0 w-5 text-center text-muted-foreground">
                    H{heading.level}
                  </span>
                  <TooltipProvider delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`text-sm truncate text-foreground ${heading.level <= 2 ? "font-medium" : ""}`}>
                          {heading.text || "Untitled"}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        {heading.text || "Untitled"}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </button>
              ))
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center px-4 h-8 border-t border-border bg-muted text-muted-foreground text-[11px]">
          <span>Click a heading to navigate</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
