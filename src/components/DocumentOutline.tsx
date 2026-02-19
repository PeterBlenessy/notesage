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
    // Set selection to the heading position + 1 (inside the heading node)
    editor.commands.setTextSelection(pos + 1);
    editor.commands.scrollIntoView();
    onOpenChange(false);
    // Focus the editor after navigation
    requestAnimationFrame(() => editor.commands.focus());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogHeader className="sr-only">
        <DialogTitle>Document Outline</DialogTitle>
        <DialogDescription>Navigate to headings in the document</DialogDescription>
      </DialogHeader>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden" showCloseButton={false}>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 h-12 border-b"
          style={{ borderColor: "var(--color-border)" }}
        >
          <List className="h-4 w-4 shrink-0" style={{ color: "var(--color-muted-foreground)" }} />
          <span className="text-[13px] font-medium" style={{ color: "var(--color-foreground)" }}>
            Document Outline
          </span>
          <span className="text-[11px] ml-auto" style={{ color: "var(--color-muted-foreground)" }}>
            {headings.length} {headings.length === 1 ? "heading" : "headings"}
          </span>
        </div>

        {/* Heading list */}
        <div className="max-h-[360px] overflow-y-auto py-1">
          {headings.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[13px]" style={{ color: "var(--color-muted-foreground)" }}>
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
                  className="w-full text-left py-1.5 flex items-center gap-2 transition-colors mx-1 hover:bg-accent"
                  style={{
                    width: "calc(100% - 8px)",
                    borderRadius: "6px",
                    paddingLeft: `${12 + indent}px`,
                    paddingRight: "12px",
                  }}
                >
                  <span
                    className="text-[11px] font-mono shrink-0 w-5 text-center"
                    style={{ color: "var(--color-muted-foreground)" }}
                  >
                    H{heading.level}
                  </span>
                  <span
                    className="text-[13px] truncate"
                    style={{
                      color: "var(--color-foreground)",
                      fontWeight: heading.level <= 2 ? 500 : 400,
                    }}
                  >
                    {heading.text || "Untitled"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hints */}
        <div
          className="flex items-center px-4 h-8 border-t text-[11px]"
          style={{
            borderColor: "var(--color-border)",
            backgroundColor: "var(--color-muted)",
            color: "var(--color-muted-foreground)",
          }}
        >
          <span>Click a heading to navigate</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
