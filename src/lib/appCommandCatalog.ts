import rawManifest from "@/shared/appCommandManifest.json";

export interface ChordDef {
  key?: string;
  code?: string;
  mod?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Where a command's chord is dispatched. `global` commands run through the
 *  App-root dispatcher (`useGlobalShortcuts`); the others are owned by their
 *  respective surfaces (editor keymaps, the command bar, the sidebar) and are
 *  listed here only so they appear in the ⌘⇧K reference and generated docs. */
export type ShortcutScope = "global" | "editor" | "cmd-bar" | "sidebar";

/** Keydown listener phase. `capture` is reserved for the few chords that must
 *  preempt other handlers (focus mode, new note/project, the Esc fall-through). */
export type ShortcutPhase = "capture" | "bubble";

export interface AppCommand {
  id: string;
  label: string;
  display: string;
  chords: ChordDef[];
  owner?: string;
  /** Dispatch scope. Defaults to "global" when omitted. */
  scope?: ShortcutScope;
  /** When true, the chord fires even while focus is in an input / textarea /
   *  contentEditable (e.g. ⌘K). Defaults to false — typed-into surfaces own
   *  their own keystrokes. Only meaningful for `scope: "global"`. */
  firesWhileTyping?: boolean;
  /** Listener phase for global-scope commands. Defaults to "bubble". */
  phase?: ShortcutPhase;
  /** Whether the dispatcher calls `preventDefault()` on a match. Defaults to
   *  true. Set false for chords that must keep propagating (e.g. the Esc
   *  fall-through chain). Only meaningful for `scope: "global"`. */
  preventDefault?: boolean;
}

const commands = rawManifest.commands as AppCommand[];

export const catalog: Record<string, AppCommand> = Object.fromEntries(
  commands.map((cmd) => [cmd.id, cmd]),
);

/**
 * Returns true when a KeyboardEvent matches a chord definition.
 *
 * Modifier fields are checked only when explicitly set in the chord:
 *   - `mod`     → platform command key (metaKey || ctrlKey)
 *   - `metaKey` → strict metaKey check
 *   - `ctrlKey` → strict ctrlKey check (use for ⌃Tab — must not fire on ⌘Tab)
 *   - `shiftKey`, `altKey` → straightforward equality
 *
 * Key/code matching:
 *   - Both `key` and `code` defined → match via key OR code (cross-layout safety
 *     for punctuation chords where the physical position matters more than the
 *     produced character, e.g. ⌘, on a non-US layout).
 *   - Only `code` defined → match by physical key position only (e.g. ⌘⌥C where
 *     Option+C produces ç on macOS, not the letter C).
 *   - Only `key` defined → match by produced character only.
 */
export function matchesChord(event: KeyboardEvent, chord: ChordDef): boolean {
  // Platform-mod (metaKey || ctrlKey) check
  if (chord.mod !== undefined) {
    const isMod = event.metaKey || event.ctrlKey;
    if (chord.mod && !isMod) return false;
    if (!chord.mod && isMod) return false;
  }

  // Explicit metaKey check (used by ⌃Tab chord to reject ⌘Tab)
  if (chord.metaKey !== undefined && event.metaKey !== chord.metaKey) return false;

  // Explicit ctrlKey check
  if (chord.ctrlKey !== undefined && event.ctrlKey !== chord.ctrlKey) return false;

  // Shift and Alt
  if (chord.shiftKey !== undefined && event.shiftKey !== chord.shiftKey) return false;
  if (chord.altKey !== undefined && event.altKey !== chord.altKey) return false;

  // Key / code matching
  if (chord.key !== undefined && chord.code !== undefined) {
    // Both defined: accept if either matches (cross-layout safe)
    if (event.key !== chord.key && event.code !== chord.code) return false;
  } else if (chord.key !== undefined) {
    if (event.key !== chord.key) return false;
  } else if (chord.code !== undefined) {
    if (event.code !== chord.code) return false;
  } else {
    return false;
  }

  return true;
}
