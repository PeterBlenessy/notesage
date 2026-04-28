/**
 * Verb-mode registry + detector for the FloatingCommandBar
 * (PRD `2026-04-28-cmd-bar-verb-prefixes`).
 *
 * The cmd bar's prefix grammar splits into two namespaces:
 *
 *   Single character → noun pickers (`/skill`, `@reference`, `#tag`,
 *     `!task`, `?research`, `>palette`) — see `prefix-modes.ts`.
 *   `:` + multi-char name → verb commands (`:file foo`,
 *     `:find-in-files bar` future) — this module.
 *
 * Verbs are invoked at start-of-input (or after whitespace) as
 * `:name <filter>`. Everything after the FIRST space is the verb's
 * filter input; everything before is the verb name. Bare `:` (with
 * cursor right after) is the discovery state — the bar renders a
 * list of every registered verb so users find them without docs.
 *
 * This module is **logic only** — no React, no lucide imports. Verb
 * pickers consume `VERBS[id]` and resolve their own icons.
 *
 * Acceptance: adding a new verb means adding one entry to `VERBS`
 * and writing one mode-picker file. The detector and Tab-completion
 * helpers below are generic over the registry.
 */

export type VerbId = 'file';

export interface VerbMode {
  /** Stable id used by mode pickers. */
  id: VerbId;
  /**
   * Multi-char name typed after the `:` — what the user actually
   * spells. Must be unique across `VERBS` and contain no whitespace
   * (the detector treats whitespace as the verb-name terminator).
   */
  name: string;
  /** Human-readable label shown in the mode badge / picker header. */
  label: string;
  /**
   * Lucide icon name. We deliberately pass a string instead of
   * importing the component here — this file is logic-only, and each
   * picker resolves its own icon.
   */
  icon: string;
  /** One-line description shown in the discovery menu / badge tooltip. */
  description: string;
}

/**
 * Central verb registry. Add a new verb by appending one entry —
 * no detector/autocomplete plumbing needs to change.
 */
export const VERBS: Record<VerbId, VerbMode> = {
  file: {
    id: 'file',
    name: 'file',
    label: 'File',
    icon: 'FileText',
    description: 'Find a file by name',
  },
};

/** Lookup table: verb name → mode. Built once at module load. */
const VERBS_BY_NAME: Record<string, VerbMode> = Object.values(VERBS).reduce(
  (acc, verb) => {
    acc[verb.name] = verb;
    return acc;
  },
  {} as Record<string, VerbMode>,
);

export interface ActiveVerb {
  /**
   * The matched verb metadata, or `null` when the input is bare `:`
   * or `:partial-name` that doesn't match any registered verb. The
   * picker uses `verb: null` to render the discovery menu.
   */
  verb: VerbMode | null;
  /** Index of the `:` character in the input. */
  verbStart: number;
  /**
   * Exclusive end of the verb-name token (next whitespace, or input
   * length when no whitespace follows). For `:file foo`, this is
   * the index of the space after `file`.
   */
  verbEnd: number;
  /**
   * Start index of the verb's filter slot — the position right
   * after the first whitespace following the verb name. Equal to
   * `verbEnd` when the verb name has no trailing space yet (the
   * cursor is still in the name region).
   */
  filterStart: number;
  /**
   * Exclusive end of the verb's filter slot. Today this runs to the
   * next whitespace after `filterStart`; future verbs that want
   * multi-word filters can define their own slot semantics by
   * post-processing this region.
   */
  filterEnd: number;
  /** Filter text (slice between `filterStart` and `filterEnd`). */
  filter: string;
  /**
   * The partial verb-name token typed so far (slice between `:` and
   * `verbEnd`). Useful for the discovery menu to filter the verb
   * list by typed prefix.
   */
  typedName: string;
  /**
   * How the verb came to be active. Drives Esc behaviour:
   *   - `'typed'`: the user typed `:` into the input. First Esc
   *     clears just the verb (back to chat mode, bar stays expanded);
   *     a second Esc collapses.
   *   - `'chord'`: the verb was seeded by a keyboard chord
   *     (`⌘⇧F` → `:file `). First Esc collapses the bar.
   *
   * `detectActiveVerb` always returns `'typed'`; chord-seeding call
   * sites override to `'chord'`.
   */
  source: 'typed' | 'chord';
}

/**
 * Detects whether the cursor sits within an active verb token.
 *
 * Returns metadata when the cursor is inside the region
 * `<whitespace|start>:<verb-name>[<space><filter>]`.
 *
 * Returns `null` when the cursor is outside any verb region (so the
 * caller treats `:` as literal text). Returns `{verb: null, …}` when
 * the cursor IS inside a `:`-prefixed region but the typed name
 * doesn't match any registered verb — the caller renders the
 * discovery menu in that state.
 */
export function detectActiveVerb(
  input: string,
  cursorPosition: number,
): ActiveVerb | null {
  if (input.length === 0) return null;
  const cursor = Math.max(0, Math.min(cursorPosition, input.length));
  if (cursor === 0) return null;

  // Walk back from `cursor - 1` looking for `:` at start-of-input or
  // after whitespace. Stop on any whitespace BEFORE finding `:` only
  // if we haven't already crossed the verb's filter slot — that is,
  // we allow ONE whitespace inside the active region (the separator
  // between verb name and filter).
  let verbStart = -1;
  let crossedSpace = false;
  for (let i = cursor - 1; i >= 0; i -= 1) {
    const ch = input[i];
    if (ch === ':') {
      const isStart = i === 0;
      const precededByWs = i > 0 && isWhitespace(input[i - 1]);
      if (isStart || precededByWs) {
        verbStart = i;
      }
      break;
    }
    if (isWhitespace(ch)) {
      if (crossedSpace) {
        // Already crossed the name/filter separator; a second
        // whitespace ends the active region.
        return null;
      }
      crossedSpace = true;
    }
  }
  if (verbStart === -1) return null;

  // Walk forward from `verbStart + 1` to find the verb-name end
  // (first whitespace) and the filter end (second whitespace, or EOL).
  let verbEnd = input.length;
  for (let j = verbStart + 1; j < input.length; j += 1) {
    if (isWhitespace(input[j])) {
      verbEnd = j;
      break;
    }
  }
  // Empty verb-name (`: ` with cursor right after `:`) → still
  // discovery state but with no typed prefix.
  const typedName = input.slice(verbStart + 1, verbEnd);

  // Filter slot starts after the FIRST whitespace following the verb
  // name (if any).
  let filterStart = verbEnd;
  let filterEnd = verbEnd;
  if (verbEnd < input.length) {
    filterStart = verbEnd + 1;
    filterEnd = input.length;
    for (let k = filterStart; k < input.length; k += 1) {
      if (isWhitespace(input[k])) {
        filterEnd = k;
        break;
      }
    }
  }

  // Reject when cursor sits past the active region. If we got here
  // we know cursor > verbStart; reject when it's beyond `filterEnd`.
  if (cursor > filterEnd) return null;

  const verb = VERBS_BY_NAME[typedName] ?? null;
  return {
    verb,
    verbStart,
    verbEnd,
    filterStart,
    filterEnd,
    filter: input.slice(filterStart, filterEnd),
    typedName,
    source: 'typed',
  };
}

/**
 * Pure helper for the verb-name `Tab` autocomplete.
 *
 * Returns the next input state when `Tab` should advance autocompletion,
 * or `null` when `Tab` should fall through to the verb's filter (or be
 * a no-op).
 *
 * Rules (per PRD `2026-04-28-cmd-bar-verb-prefixes`):
 *
 *   - `:` (no name typed)         → null (discovery list shows; Tab is no-op)
 *   - `:f` (one match: `file`)    → `:file ` + cursor at end + jumpToFilter
 *   - `:f` (two matches: file, find-in-files) → `:fi` + cursor at end (longest common prefix)
 *   - `:fi` (no further completion possible) → null (discovery list shows the candidates)
 *   - `:file` (full match)        → `:file ` + cursor at end + jumpToFilter
 *   - `:file ` (cursor in filter) → null (verb mode picker decides what Tab does)
 *   - `:zzz` (no match)           → null (input unchanged)
 */
export function computeTabCompletion(
  input: string,
  cursor: number,
  verbs: VerbMode[] = Object.values(VERBS),
): { newInput: string; newCursor: number; jumpToFilter: boolean } | null {
  const active = detectActiveVerb(input, cursor);
  if (!active) return null;
  // If cursor is in the filter slot (past `verbEnd`), let the verb
  // picker handle Tab — autocomplete operates on the verb name only.
  if (cursor > active.verbEnd) return null;

  const typed = active.typedName;
  const candidates = verbs.filter((v) => v.name.startsWith(typed));
  if (candidates.length === 0) return null;

  if (candidates.length === 1) {
    // Single match — complete the name and append a trailing space
    // so the cursor lands in the filter slot.
    const fullName = candidates[0].name;
    const before = input.slice(0, active.verbStart);
    const after = input.slice(active.verbEnd);
    // Only append a space if there isn't already one immediately
    // after the verb name in the original input (covers the `:file`
    // → `:file ` case AND the `:file<cursor>foo` case where the
    // user has already typed extra after the cursor).
    const needsSpace = after === '' || !isWhitespace(after[0]);
    const replaced = `:${fullName}${needsSpace ? ' ' : ''}`;
    const newInput = before + replaced + after;
    const newCursor = before.length + replaced.length;
    return { newInput, newCursor, jumpToFilter: true };
  }

  // Multiple candidates — completion to longest common prefix.
  const lcp = longestCommonPrefix(candidates.map((v) => v.name));
  if (lcp.length <= typed.length) {
    // Already at the longest unambiguous prefix; the discovery menu
    // surfaces the candidates instead.
    return null;
  }
  const before = input.slice(0, active.verbStart);
  const after = input.slice(active.verbEnd);
  const replaced = `:${lcp}`;
  const newInput = before + replaced + after;
  const newCursor = before.length + replaced.length;
  return { newInput, newCursor, jumpToFilter: false };
}

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i += 1) {
    while (!strings[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (prefix === '') return '';
    }
  }
  return prefix;
}

function isWhitespace(ch: string): boolean {
  return /\s/.test(ch);
}
