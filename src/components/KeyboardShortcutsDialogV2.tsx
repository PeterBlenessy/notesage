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
        Live-test 2026-04-26 — fixed the dialog content visibly
        leaking outside the dialog frame. Previous version used
        `max-w-[1040px]` (no responsive viewport cap) plus CSS
        multi-column (`sm:columns-2`) which can grow content past
        the dialog's measured width. Switched to the
        `LocalAIModelsDialog` / `ChangelogDialog` pattern:
          - Hard width cap with viewport fallback
            (`w-[calc(100vw-48px)] sm:max-w-[920px]`).
          - Hard height cap (`h-[min(720px,calc(100vh-48px))]`).
          - `overflow-hidden flex flex-col` on the outer dialog so
            the inner ScrollArea owns vertical scrolling.
          - Body switched from CSS multi-column to a responsive
            2-column grid (`md:grid-cols-2`) — keeps each section
            inside its column and avoids overflow.
      */}
      <DialogContent className="w-[calc(100vw-48px)] sm:max-w-[920px] h-[min(720px,calc(100vh-48px))] p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-8 pt-7 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-[20px] font-semibold tracking-tight">
            Keyboard Shortcuts
          </DialogTitle>
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed">
            Press <Kbd>⌘</Kbd> <Kbd>⇧</Kbd> <Kbd>K</Kbd> any time to reopen this
            reference.
          </p>
        </DialogHeader>
        <div className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            <div className="px-8 py-6 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
