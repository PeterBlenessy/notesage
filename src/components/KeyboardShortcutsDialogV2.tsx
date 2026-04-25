import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Keyboard Shortcuts dialog — Quiet Composer variant (task #137).
 *
 * Same shortcut catalogue as the legacy `KeyboardShortcutsDialog`; only
 * the chrome changes to match the v2 settings aesthetic:
 *   - Generous 28 px dialog padding (vs 20 px in legacy).
 *   - Sans-serif 24 px semibold title (matches the per-panel headers in
 *     `SettingsDialogV2`).
 *   - Shortcut groups render as `SettingsGroup`-styled cards (label in
 *     muted uppercase, content on a card surface with subtle border).
 *   - Wider (560 px) so the `Kbd` combos don't wrap.
 *
 * Mounted in App.tsx alongside the legacy dialog; `uiPreview` decides
 * which one opens.
 */

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
      { action: "Undo", keys: [["⌘", "Z"]] },
      { action: "Redo", keys: [["⌘", "⇧", "Z"]] },
    ],
  },
  {
    label: "Find",
    shortcuts: [
      { action: "Find in document", keys: [["⌘", "F"]] },
      { action: "Find and replace", keys: [["⌘", "⇧", "H"]] },
      { action: "Search files", keys: [["⌘", "⇧", "F"]] },
      { action: "Search @mentions", keys: [["⌘", "2"]] },
      { action: "Search #tags", keys: [["⌘", "3"]] },
      { action: "Search research", keys: [["⌘", "4"]] },
    ],
  },
  {
    label: "Navigation",
    shortcuts: [
      { action: "Command palette", keys: [["⌘", "K"]] },
      { action: "Double-tap Command (Quiet Composer)", keys: [["⌘", "⌘"]] },
      { action: "Toggle sidebar", keys: [["⌘", "⇧", "L"]] },
      { action: "Toggle chat panel / command bar", keys: [["⌘", "⇧", "C"]] },
      { action: "Toggle agent panel", keys: [["⌘", "⇧", "A"]] },
      { action: "Tree overlay (Quiet Composer)", keys: [["⌘", "⇧", "E"]] },
      { action: "Focus mode", keys: [["⌘", "."]] },
      { action: "Document outline", keys: [["⌘", "⇧", "O"]] },
      { action: "Previous recent document", keys: [["⌘", "⇧", "["]] },
      { action: "Next recent document", keys: [["⌘", "⇧", "]"]] },
      { action: "Keyboard shortcuts", keys: [["⌘", "⇧", "K"]] },
    ],
  },
  {
    label: "AI & Voice",
    shortcuts: [
      { action: "Add comment", keys: [["⌘", "⇧", "M"]] },
      { action: "Toggle recording", keys: [["⌘", "⇧", "R"]] },
      { action: "Accept suggestion", keys: [["⌘", "↵"]] },
      { action: "Reject suggestion", keys: [["⌘", "⌫"]] },
      { action: "Quick capture (global)", keys: [["⌘", "⇧", "Space"]] },
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
    <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md bg-muted border border-border text-[11px] font-mono leading-none text-foreground">
      {children}
    </kbd>
  );
}

interface KeyboardShortcutsDialogV2Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function KeyboardShortcutsDialogV2({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogV2Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        Live-test 2026-04-25 #159 — bumped from 560 px → 880 px wide
        and switched the body to a 2-column grid (`md:grid-cols-2`).
        Six categories now fit on a single viewport on a typical
        laptop screen instead of forcing the user to scroll. Columns
        collapse to 1 below 720 px so the dialog still works on
        narrower windows. Categories preserve their original order
        going down each column (CSS column-count would reflow into
        balanced halves, but ordering by category is more predictable
        for the user — top-to-bottom in column 1, then column 2).
      */}
      <DialogContent className="max-w-[880px] p-0 gap-0">
        <DialogHeader className="px-7 pt-7 pb-3 border-b border-border">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">
            Keyboard Shortcuts
          </DialogTitle>
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            Press <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>K</Kbd> any time to reopen this
            reference.
          </p>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh]">
          <div className="px-7 py-5 grid gap-x-6 gap-y-6 md:grid-cols-2">
            {categories.map((category) => (
              <section
                key={category.label}
                aria-labelledby={`shortcut-group-${category.label}`}
              >
                <h3
                  id={`shortcut-group-${category.label}`}
                  className="uppercase text-[11px] tracking-wider font-medium text-muted-foreground mb-2"
                >
                  {category.label}
                </h3>
                <div className="rounded-lg border border-border divide-y divide-border/60 bg-card">
                  {category.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.action}
                      className="flex items-center justify-between gap-4 px-3 py-2"
                    >
                      <span className="text-[13px] text-foreground min-w-0 truncate">
                        {shortcut.action}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {shortcut.keys.map((combo, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-0.5"
                          >
                            {combo.map((key, j) => (
                              <Kbd key={j}>{key}</Kbd>
                            ))}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
