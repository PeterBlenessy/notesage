import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Command as CommandIcon,
  FileOutput,
  FilePlus,
  Focus,
  FolderDot,
  Keyboard,
  ListChecks,
  MessageSquare,
  PanelLeft,
  PencilLine,
  Settings,
  SunMoon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PaletteMode — picker rendered when the FloatingCommandBar is in `>` mode
 * (PRD `2026-04-21-ui-refresh`, Phase 1, task #19).
 *
 * Pure presentation: holds the inline command registry, filters by the
 * caller's `filter` string, lets the user navigate with ↑/↓ and pick with
 * Enter or click. The picker emits `onPick(commandId)` and never runs the
 * command's `execute` itself — wiring real Notesage actions to ids is the
 * parent's job (will land in #20 and beyond).
 */

export interface PaletteCommand {
  /** Stable identifier the parent maps back to a real action. */
  id: string;
  /** Human-readable label rendered as the row text. */
  label: string;
  /** Optional one-line description (currently unused but kept on the type). */
  description?: string;
  /**
   * Lucide icon name as a string. Resolved against `ICONS` below; commands
   * with an unknown or absent name fall back to the generic `Command` glyph.
   */
  icon?: string;
  /** Pre-formatted shortcut hint, e.g. `"⌘N"`. Rendered right-aligned. */
  shortcut?: string;
  /**
   * Called when the command is selected. The picker does NOT invoke this —
   * the parent calls it after mapping the id back to a command. Kept on the
   * type so the registry stays a single source of truth as we wire actions
   * in #20+.
   */
  execute: () => void | Promise<void>;
}

interface PaletteModeProps {
  /** Text typed after the `>` prefix (the prefix itself is stripped). */
  filter: string;
  /**
   * Called when the user picks a row (Enter or click). The parent maps the
   * id to a command and runs `execute()`, then clears the `>` prefix.
   */
  onPick: (commandId: string) => void;
  /** Optional Escape handler. Hooked from the parent if needed. */
  onDismiss?: () => void;
  /**
   * DOM id used as the listbox's `id` attribute and as the prefix for option
   * ids. Enables the parent `FloatingCommandBar` to wire `aria-controls` and
   * `aria-activedescendant` on its combobox input.
   */
  listboxId?: string;
  /**
   * Fires whenever the active option / result count changes. Lets the parent
   * FloatingCommandBar keep `aria-activedescendant` in sync without the
   * picker moving DOM focus away from the input.
   */
  onActiveOptionChange?: (info: {
    listboxId: string;
    activeOptionId: string | null;
    count: number;
  }) => void;
}

// ---------------------------------------------------------------------------
// Icon registry — small explicit map. Keeps the bundle lean (no dynamic
// require of all of lucide-react) and lets unknown names fall back gracefully.
// ---------------------------------------------------------------------------

const ICONS: Record<string, LucideIcon> = {
  FilePlus,
  FolderDot,
  FileOutput,
  SunMoon,
  PanelLeft,
  Settings,
  Focus,
  MessageSquare,
  ListChecks,
  PencilLine,
  Keyboard,
  BookOpen,
};

// ---------------------------------------------------------------------------
// Inline command registry. Sourced from the existing CommandPalette actions
// list (see `src/components/CommandPalette.tsx`) — copied as a static array
// so the picker stays decoupled from the legacy palette wiring.
//
// `execute` is intentionally a no-op here. Real wiring lands in #20 when
// FloatingCommandBar dispatches commands by id. Until then the picker is
// pure presentation.
//
// "Preview HTML" is intentionally omitted — it's removed in #72.
// ---------------------------------------------------------------------------

const noop = () => {};

export const PALETTE_COMMANDS: PaletteCommand[] = [
  {
    id: 'new-note',
    label: 'New note',
    description: 'Create a new note in the current project',
    icon: 'FilePlus',
    shortcut: '⌘N',
    execute: noop,
  },
  {
    id: 'new-project',
    label: 'New project',
    description: 'Create a new project workspace',
    icon: 'FolderDot',
    shortcut: '⌘⇧N',
    execute: noop,
  },
  {
    id: 'export-pdf',
    label: 'Export as PDF',
    description: 'Export the active document to PDF',
    icon: 'FileOutput',
    shortcut: '⌘⇧E',
    execute: noop,
  },
  {
    id: 'toggle-theme',
    label: 'Toggle theme',
    description: 'Switch between light and dark mode',
    icon: 'SunMoon',
    shortcut: '⌘T',
    execute: noop,
  },
  {
    id: 'toggle-sidebar',
    label: 'Toggle sidebar',
    description: 'Show or hide the file sidebar',
    icon: 'PanelLeft',
    shortcut: '⌘⇧L',
    execute: noop,
  },
  {
    id: 'open-settings',
    label: 'Open settings',
    description: 'Open the Notesage settings dialog',
    icon: 'Settings',
    shortcut: '⌘,',
    execute: noop,
  },
  {
    id: 'toggle-focus-mode',
    label: 'Toggle focus mode',
    description: 'Enter or exit distraction-free focus mode',
    icon: 'Focus',
    shortcut: '⌘.',
    execute: noop,
  },
  {
    id: 'toggle-chat-panel',
    label: 'Toggle chat panel',
    description: 'Show or hide the AI chat sidebar',
    icon: 'MessageSquare',
    shortcut: '⌘⇧C',
    execute: noop,
  },
  {
    id: 'toggle-agent-panel',
    label: 'Toggle agent panel',
    description: 'Show or hide the agent activity panel',
    icon: 'ListChecks',
    shortcut: '⌘⇧A',
    execute: noop,
  },
  {
    id: 'document-outline',
    label: 'Document outline',
    description: 'Open the outline for the active document',
    icon: 'PencilLine',
    shortcut: '⌘⇧O',
    execute: noop,
  },
  {
    id: 'open-keyboard-shortcuts',
    label: 'Keyboard shortcuts',
    description: 'View the full keyboard shortcuts reference',
    icon: 'Keyboard',
    shortcut: '⌘7',
    execute: noop,
  },
];

// Live-test 2026-04-26 — uncapped to match the legacy palette which shows
// every matching action. The bar's picker tray is `overflow-y-auto` so a
// long list scrolls instead of overflowing.

function PaletteMode({
  filter,
  onPick,
  onDismiss,
  listboxId = 'cmd-palette-listbox',
  onActiveOptionChange,
}: PaletteModeProps) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return PALETTE_COMMANDS;
    return PALETTE_COMMANDS.filter((cmd) => {
      if (cmd.label.toLowerCase().includes(q)) return true;
      if (cmd.description && cmd.description.toLowerCase().includes(q)) {
        return true;
      }
      return false;
    });
  }, [filter]);

  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Reset highlight when the result set changes — first row is always
  // pre-selected so Enter fires the most relevant match without a keystroke.
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filter, filtered.length]);

  // Report active option state upward so the parent can mirror it on its
  // combobox input via aria-activedescendant.
  useEffect(() => {
    if (!onActiveOptionChange) return;
    const activeOptionId =
      filtered.length > 0 ? `${listboxId}-opt-${highlightedIndex}` : null;
    onActiveOptionChange({
      listboxId,
      activeOptionId,
      count: filtered.length,
    });
  }, [onActiveOptionChange, listboxId, highlightedIndex, filtered.length]);

  const listRef = useRef<HTMLDivElement | null>(null);

  // Live-test 2026-04-26 — listen on `window` so the picker handles
  // ArrowUp/Down/Enter while the parent FloatingCommandBar's textarea
  // owns focus. The previous `onKeyDown` on the picker root never fired
  // (input was never blurred). Mirrors `TagMode`/`TaskMode`/`SkillMode`.
  useEffect(() => {
    if (filtered.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[highlightedIndex];
        if (cmd) onPick(cmd.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onDismiss?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [filtered, highlightedIndex, onPick, onDismiss]);

  if (filtered.length === 0) {
    return (
      <div
        className="px-3 py-2 text-xs text-muted-foreground"
        data-palette-empty="true"
      >
        No commands match
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      tabIndex={-1}
      aria-label="Command palette results"
      data-palette-list="true"
      className={cn(
        'flex flex-col py-1',
      )}
    >
      {filtered.map((cmd, index) => {
        const Icon = (cmd.icon && ICONS[cmd.icon]) || CommandIcon;
        const isHighlighted = index === highlightedIndex;
        return (
          <button
            type="button"
            key={cmd.id}
            id={`${listboxId}-opt-${index}`}
            data-palette-row={cmd.id}
            data-highlighted={isHighlighted ? 'true' : undefined}
            role="option"
            aria-selected={isHighlighted}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => onPick(cmd.id)}
            className={cn(
              // Density (live-test 2026-04-26): smaller text + tighter
              // vertical padding match the legacy command palette and
              // the tightened sibling pickers.
              'flex items-center gap-2 px-3 py-1.5 text-left text-[13px]',
              'transition-colors',
              isHighlighted
                ? 'bg-muted border border-[var(--color-accent-primary)] rounded-md text-foreground'
                : 'text-foreground hover:bg-muted/60',
              'focus-visible:outline-none',
            )}
          >
            <Icon
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden="true"
            />
            <span className="flex-1 truncate">{cmd.label}</span>
            {cmd.shortcut ? (
              <kbd
                className={cn(
                  'shrink-0 rounded border border-border bg-background',
                  'px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground',
                )}
              >
                {cmd.shortcut}
              </kbd>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default PaletteMode;
