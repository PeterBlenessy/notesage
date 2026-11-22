import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { catalog, type AppCommand } from "@/lib/appCommandCatalog";
import { isAlphaBuild } from "@/lib/build-channel";

/**
 * Keyboard Shortcuts dialog (task #137).
 *
 * Chrome matches the v2 settings aesthetic:
 *   - Generous 28 px dialog padding.
 *   - Sans-serif 24 px semibold title (matches the per-panel headers in
 *     `SettingsDialogV2`).
 *   - Shortcut groups render as `SettingsGroup`-styled cards (label in
 *     muted uppercase, content on a card surface with subtle border).
 *   - Wider (560 px) so the `Kbd` combos don't wrap.
 */

/**
 * Where the rows come from:
 *
 *   - App-level chords are read from the command manifest
 *     (`appCommandManifest.json` via `appCommandCatalog`). A group lists them
 *     by command id only; the label and the chord both come from the manifest,
 *     so this reference cannot disagree with what the dispatcher binds. A
 *     manifest command that no group places is appended under "Other" rather
 *     than silently dropped.
 *   - Editor-owned chords are not in the manifest (they are bound by Tiptap /
 *     ProseMirror keymaps or a local listener), so they stay a static list.
 *     Each one names the code that binds it — check that before editing.
 */

interface ShortcutEntry {
  /** Manifest command id, or undefined for an editor-owned chord. */
  commandId?: string;
  action: string;
  keys: string[];
}

interface ShortcutCategory {
  label: string;
  shortcuts: ShortcutEntry[];
}

/** A manifest command id, or a static editor-owned chord. */
type ShortcutSource = string | { action: string; keys: string[] };

interface ShortcutGroupDef {
  label: string;
  items: ShortcutSource[];
}

const GROUPS: ShortcutGroupDef[] = [
  {
    label: "File Operations",
    items: [
      // window keydown listener in `useEditorKeyBindings.ts`
      { action: "Save", keys: ["⌘", "S"] },
      "open-folder",
      "close-active-document",
      "new-note",
      "new-project",
      "export-document",
    ],
  },
  {
    label: "Editor",
    items: [
      // Tiptap StarterKit marks: Bold `Mod-b`, Italic `Mod-i`,
      // Underline `Mod-u`, Strike `Mod-Shift-s`, Code `Mod-e`.
      { action: "Bold", keys: ["⌘", "B"] },
      { action: "Italic", keys: ["⌘", "I"] },
      { action: "Underline", keys: ["⌘", "U"] },
      { action: "Strikethrough", keys: ["⌘", "⇧", "S"] },
      { action: "Code", keys: ["⌘", "E"] },
      // Tiptap UndoRedo: `Mod-z` / `Shift-Mod-z`
      { action: "Undo", keys: ["⌘", "Z"] },
      { action: "Redo", keys: ["⌘", "⇧", "Z"] },
      // `Mod-Shift-v` in `extensions/paste-handler.ts`
      { action: "Paste as plain text", keys: ["⌘", "⇧", "V"] },
      "zoom-in",
      "zoom-out",
      "zoom-reset",
    ],
  },
  {
    label: "Find",
    items: [
      "find-in-document",
      "find-replace",
      "find-files",
      "open-mentions",
      "open-tags",
      "open-research",
      "open-tasks",
      "open-commands-palette",
    ],
  },
  {
    label: "Navigation",
    items: [
      "open-command-palette",
      // double-tap ⌘ tracker in `useGlobalShortcuts.ts` (not a chord)
      { action: "Open command palette (double-tap)", keys: ["⌘", "⌘"] },
      "toggle-sidebar",
      "toggle-activity-agent",
      "toggle-focus-mode",
      "exit-focus-mode",
      "open-document-outline",
      "open-inbox",
      "inbox-next",
      "inbox-previous",
      "cycle-recent-previous",
      "cycle-recent-next",
      "copy-document-path",
      "reveal-in-finder",
      "keyboard-shortcuts",
    ],
  },
  {
    label: "AI & Voice",
    items: [
      // ProseMirror `handleKeyDown` in `extensions/comment-mark.ts`
      { action: "Add comment on selection", keys: ["⌘", "⌥", "C"] },
      "toggle-recording",
      // `Mod-Enter` / `Mod-Backspace` in `extensions/ai-suggestion.ts` and
      // `extensions/inline-diff.ts`
      { action: "Accept inline suggestion", keys: ["⌘", "↵"] },
      { action: "Reject inline suggestion", keys: ["⌘", "⌫"] },
    ],
  },
  {
    label: "Settings",
    items: ["toggle-theme", "open-settings", "open-devtools"],
  },
];

const OTHER_GROUP_LABEL = "Other";

/** Commands whose action is a no-op unless a runtime condition holds; listing
 *  them when it does not would advertise a chord that does nothing. */
const AVAILABILITY: Record<string, () => boolean> = {
  "open-devtools": isAlphaBuild,
};

const MODIFIER_GLYPHS = new Set(["⌘", "⌥", "⇧", "⌃"]);

/** Split a manifest `display` string into key caps: each leading modifier
 *  glyph is its own cap, the rest is the key ("⌃⇧Tab" → ⌃ ⇧ Tab). */
function splitDisplay(display: string): string[] {
  const glyphs = Array.from(display);
  let i = 0;
  while (i < glyphs.length - 1 && MODIFIER_GLYPHS.has(glyphs[i])) i++;
  return [...glyphs.slice(0, i), glyphs.slice(i).join("")];
}

function isAvailable(commandId: string): boolean {
  return AVAILABILITY[commandId]?.() ?? true;
}

function commandEntry(commandId: string): ShortcutEntry | null {
  // The catalog is typed as total, but a group may name an id the manifest
  // has since dropped.
  const command: AppCommand | undefined = catalog[commandId];
  if (!command || !isAvailable(commandId)) return null;
  return { commandId, action: command.label, keys: splitDisplay(command.display) };
}

function buildCategories(): ShortcutCategory[] {
  const placed = new Set<string>();
  const categories: ShortcutCategory[] = GROUPS.map((group) => ({
    label: group.label,
    shortcuts: group.items.flatMap((item) => {
      if (typeof item !== "string") return [item];
      placed.add(item);
      const entry = commandEntry(item);
      return entry ? [entry] : [];
    }),
  }));
  const unplaced = Object.keys(catalog)
    .filter((id) => !placed.has(id))
    .flatMap((id) => commandEntry(id) ?? []);
  if (unplaced.length > 0) {
    categories.push({ label: OTHER_GROUP_LABEL, shortcuts: unplaced });
  }
  return categories.filter((category) => category.shortcuts.length > 0);
}

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
  // Built per render, not at module load: availability (the build channel)
  // resolves asynchronously at startup.
  const categories = buildCategories();
  const reopenKeys = commandEntry("keyboard-shortcuts")?.keys ?? [];
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
            Press{" "}
            <span className="inline-flex items-center gap-0.5">
              {reopenKeys.map((key, i) => (
                <Kbd key={i}>{key}</Kbd>
              ))}
            </span>{" "}
            any time to reopen this reference.
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
                        key={shortcut.commandId ?? shortcut.action}
                        data-command-id={shortcut.commandId}
                        className="flex items-center justify-between gap-4 px-3 py-2"
                      >
                        <span className="text-[13px] text-foreground min-w-0 truncate">
                          {shortcut.action}
                        </span>
                        <div className="inline-flex items-center gap-0.5 shrink-0">
                          {shortcut.keys.map((key, i) => (
                            <Kbd key={i}>{key}</Kbd>
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
