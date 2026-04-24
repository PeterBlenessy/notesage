/**
 * Prefix-mode registry + detector for the FloatingCommandBar
 * (PRD `2026-04-21-ui-refresh`, Phase 1, task #13).
 *
 * The command bar is a single input surface. As the user types, the leading
 * prefix character determines which picker mode is active:
 *
 *   /  → skill        (run a skill or agent command)
 *   @  → reference    (file / person / comment to attach)
 *   #  → tag          (hashtag from the SQLite document index)
 *   !  → task         (task reference)
 *   ?  → research     (research source)
 *   >  → palette      (command palette filter)
 *
 * This module is **logic only** — no React, no lucide imports. Mode pickers
 * (#14–#19) consume `MODES[id]` and resolve their own icons.
 *
 * Triggering rule (per PRD "Prefix character behavior"):
 *   - The prefix character must be at start-of-input OR preceded by whitespace.
 *   - A token runs from the prefix to the next whitespace (or end of string).
 *   - The cursor must sit inside that token for the mode to be considered
 *     active.
 *   - Otherwise: return `null` and the prefix character is just literal text.
 */

export type PrefixModeId =
  | 'skill'
  | 'reference'
  | 'tag'
  | 'task'
  | 'research'
  | 'palette';

export interface PrefixMode {
  /** Stable string id used by mode pickers (#14–#19). */
  id: PrefixModeId;
  /** Single-character prefix that activates this mode. */
  prefix: string;
  /** Human-readable label shown in the mode badge / picker header. */
  label: string;
  /**
   * Lucide icon name. We deliberately pass a string instead of importing the
   * component here — this file is logic-only, and each picker resolves its
   * own icon to avoid pulling lucide-react into modules that don't need it.
   */
  icon: string;
  /** One-line description shown in the mode badge tooltip / header. */
  description: string;
}

/**
 * Central mode registry. Order is canonical:
 *   skill, reference, tag, task, research, palette.
 */
export const MODES: Record<PrefixModeId, PrefixMode> = {
  skill: {
    id: 'skill',
    prefix: '/',
    label: 'Skill',
    icon: 'Zap',
    description: 'Run a skill or agent command',
  },
  reference: {
    id: 'reference',
    prefix: '@',
    label: 'Reference',
    icon: 'AtSign',
    description: 'Attach a file, person, or comment',
  },
  tag: {
    id: 'tag',
    prefix: '#',
    label: 'Tag',
    icon: 'Hash',
    description: 'Insert a tag from the document index',
  },
  task: {
    id: 'task',
    prefix: '!',
    label: 'Task',
    icon: 'CheckSquare',
    description: 'Reference or open a task',
  },
  research: {
    id: 'research',
    prefix: '?',
    label: 'Research',
    icon: 'BookOpen',
    description: 'Attach a research source',
  },
  palette: {
    id: 'palette',
    prefix: '>',
    label: 'Command',
    icon: 'ChevronRight',
    description: 'Filter and run a command',
  },
};

/**
 * Lookup table: prefix character → mode. Built once at module load.
 */
const MODES_BY_PREFIX: Record<string, PrefixMode> = Object.values(MODES).reduce(
  (acc, mode) => {
    acc[mode.prefix] = mode;
    return acc;
  },
  {} as Record<string, PrefixMode>,
);

export interface ActivePrefix {
  /** The mode metadata for the active prefix character. */
  mode: PrefixMode;
  /** Index of the prefix character in the input string. */
  prefixIndex: number;
  /** Same as `prefixIndex` — kept for clarity at call sites. */
  tokenStart: number;
  /**
   * Exclusive end of the token (next whitespace position, or input length
   * when the token runs to the end of the string).
   */
  tokenEnd: number;
  /** The text after the prefix up to `tokenEnd` (excludes the prefix itself). */
  filter: string;
  /**
   * How the prefix came to be active. Drives Esc behaviour:
   *   - `'typed'`: the user typed the prefix character into the input.
   *     First Esc clears the prefix only (bar stays expanded so the
   *     user can keep composing); a second Esc collapses the bar.
   *   - `'chord'`: the prefix was seeded by a keyboard chord
   *     (⌘1/2/3/4, ⌘⇧P, ⌘⇧F). The chord was the only thing that put
   *     the user into this mode, so Esc collapses the bar immediately.
   *
   * `detectActivePrefix` always returns `'typed'`; chord-seeding call
   * sites override to `'chord'`.
   */
  source: 'typed' | 'chord';
}

/**
 * Detects whether the cursor sits within an active prefix token.
 *
 * Returns the active prefix metadata when the cursor is inside a token
 * `<whitespace|start><prefix><filter-text>`. Returns `null` otherwise.
 *
 * Edge cases:
 *   - Empty input → null.
 *   - Cursor at index 0 with a non-empty input → null (cursor sits *before*
 *     any character, so no token is active even if input[0] is a prefix).
 *   - Mid-word prefix (no preceding whitespace) → null.
 *   - Cursor outside the token (e.g. in a later word) → null.
 */
export function detectActivePrefix(
  input: string,
  cursorPosition: number,
): ActivePrefix | null {
  if (input.length === 0) {
    return null;
  }
  // Clamp cursor to valid range.
  const cursor = Math.max(0, Math.min(cursorPosition, input.length));
  if (cursor === 0) {
    // Cursor sits before any character — no token is active.
    return null;
  }

  // Walk back from `cursor - 1` looking for the start of the current token.
  // The token start is either:
  //   - a prefix character at position 0, or
  //   - a prefix character whose preceding char is whitespace.
  // We stop walking if we hit whitespace before finding a prefix — that
  // means we're not inside any prefix token.
  let prefixIndex = -1;
  for (let i = cursor - 1; i >= 0; i -= 1) {
    const ch = input[i];
    if (isWhitespace(ch)) {
      // Hit whitespace before finding a prefix — bail.
      return null;
    }
    if (MODES_BY_PREFIX[ch]) {
      // Candidate prefix. Verify it's at start-of-input or preceded by whitespace.
      const isStart = i === 0;
      const precededByWs = i > 0 && isWhitespace(input[i - 1]);
      if (isStart || precededByWs) {
        prefixIndex = i;
      }
      // Either way, stop walking — we found the leading non-whitespace char.
      break;
    }
  }

  if (prefixIndex === -1) {
    return null;
  }

  // Walk forward from `prefixIndex + 1` to find the end of the token (next
  // whitespace, or end of string).
  let tokenEnd = input.length;
  for (let j = prefixIndex + 1; j < input.length; j += 1) {
    if (isWhitespace(input[j])) {
      tokenEnd = j;
      break;
    }
  }

  // Cursor must be inside [prefixIndex, tokenEnd] inclusive on the start.
  // (We already established cursor > 0 and cursor walked back to find the
  // prefix, so cursor > prefixIndex by construction.)
  if (cursor > tokenEnd) {
    return null;
  }

  const mode = MODES_BY_PREFIX[input[prefixIndex]];
  return {
    mode,
    prefixIndex,
    tokenStart: prefixIndex,
    tokenEnd,
    filter: input.slice(prefixIndex + 1, tokenEnd),
    // Typed into the input (as opposed to seeded by a ⌘-chord — the
    // chord-seeding call sites override this to 'chord').
    source: 'typed',
  };
}

function isWhitespace(ch: string): boolean {
  // Match the same set of whitespace characters JS regex `\s` does.
  return /\s/.test(ch);
}
