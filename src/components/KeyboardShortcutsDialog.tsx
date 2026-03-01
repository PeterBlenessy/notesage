import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ShortcutEntry {
  action: string;
  keys: string[][];
}

interface ShortcutCategory {
  label: string;
  shortcuts: ShortcutEntry[];
}

const categories: ShortcutCategory[] = [
  {
    label: "File Operations",
    shortcuts: [
      { action: "Save", keys: [["⌘", "S"]] },
      { action: "Open folder", keys: [["⌘", "O"]] },
      { action: "Close tab", keys: [["⌘", "W"]] },
      { action: "New note", keys: [["⌘", "N"]] },
      { action: "New project", keys: [["⌘", "⇧", "N"]] },
      { action: "Export as PDF", keys: [["⌘", "⇧", "E"]] },
    ],
  },
  {
    label: "Editor",
    shortcuts: [
      { action: "Bold", keys: [["⌘", "B"]] },
      { action: "Italic", keys: [["⌘", "I"]] },
      { action: "Underline", keys: [["⌘", "U"]] },
      { action: "Strikethrough", keys: [["⌘", "⇧", "X"]] },
      { action: "Code", keys: [["⌘", "E"]] },
      { action: "Link", keys: [["⌘", "K"]] },
      { action: "Undo", keys: [["⌘", "Z"]] },
      { action: "Redo", keys: [["⌘", "⇧", "Z"]] },
    ],
  },
  {
    label: "Find",
    shortcuts: [
      { action: "Find in document", keys: [["⌘", "F"]] },
      { action: "Find and replace", keys: [["⌘", "⇧", "H"]] },
    ],
  },
  {
    label: "Navigation",
    shortcuts: [
      { action: "Command palette", keys: [["⌘", "K"]] },
      { action: "Search files", keys: [["⌘", "⇧", "F"]] },
      { action: "Tag search", keys: [["⌘", "3"]] },
      { action: "Toggle sidebar", keys: [["⌘", "⇧", "L"]] },
      { action: "Toggle chat", keys: [["⌘", "⇧", "A"]] },
      { action: "Focus mode", keys: [["⌘", "."]] },
      { action: "Document outline", keys: [["⌘", "⇧", "O"]] },
      { action: "Keyboard shortcuts", keys: [["⌘", "7"]] },
    ],
  },
  {
    label: "Settings",
    shortcuts: [
      { action: "Toggle theme", keys: [["⌘", "T"]] },
      { action: "Open settings", keys: [["⌘", ","]] },
    ],
  },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded bg-muted border border-border text-[11px] font-mono leading-none">
      {children}
    </kbd>
  );
}

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-base font-semibold">Keyboard Shortcuts</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] px-5 pb-5">
          <div className="space-y-3">
            {categories.map((category) => (
              <div key={category.label} className="rounded-lg border border-border">
                <h3 className="uppercase text-[10px] tracking-wider font-medium text-muted-foreground px-3 pt-2.5 pb-1">
                  {category.label}
                </h3>
                <div className="px-3 pb-1.5">
                  {category.shortcuts.map((shortcut, idx) => (
                    <div
                      key={shortcut.action}
                      className={`flex items-center justify-between py-1.5 ${idx > 0 ? "border-t border-border/50" : ""}`}
                    >
                      <span className="text-sm text-foreground">
                        {shortcut.action}
                      </span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((combo, i) => (
                          <span key={i} className="inline-flex items-center gap-0.5">
                            {combo.map((key, j) => (
                              <Kbd key={j}>{key}</Kbd>
                            ))}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
