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

export interface AppCommand {
  id: string;
  label: string;
  display: string;
  chords: ChordDef[];
  owner?: string;
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
