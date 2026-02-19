import { useMemo } from "react";
import { List } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

  const handleSelect = (pos: number) => {
    if (!editor) return;
    editor.commands.setTextSelection(pos + 1);
    onOpenChange(false);
    requestAnimationFrame(() => {
      editor.commands.focus();
      // Scroll the heading to the top of the visible editor area
      const coords = editor.view.coordsAtPos(pos + 1);
      const editorEl = editor.view.dom.closest(".overflow-y-auto") ?? editor.view.dom.parentElement;
      if (editorEl) {
        const editorRect = editorEl.getBoundingClientRect();
        const scrollOffset = coords.top - editorRect.top - 80;
        editorEl.scrollBy({ top: scrollOffset, behavior: "smooth" });
      }
    });
  };

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
            headings.map((heading, index) => {
              const indent = (heading.level - 1) * 16;
              return (
                <button
                  key={`${heading.pos}-${index}`}
                  onClick={() => handleSelect(heading.pos)}
                  className="text-left py-1.5 pr-3 flex items-center gap-2 transition-colors duration-150 mx-1 rounded-md hover:bg-accent"
                  style={{
                    width: "calc(100% - 8px)",
                    paddingLeft: `${12 + indent}px`,
                  }}
                >
                  <span className="text-xs font-mono shrink-0 w-5 text-center text-muted-foreground">
                    H{heading.level}
                  </span>
                  <span className={`text-sm truncate text-foreground ${heading.level <= 2 ? "font-medium" : ""}`}>
                    {heading.text || "Untitled"}
                  </span>
                </button>
              );
            })
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
