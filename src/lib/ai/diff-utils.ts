import { diff_match_patch } from 'diff-match-patch';

/** One line of a unified diff ready for rendering. */
export type DiffLine =
  | { type: 'add' | 'remove' | 'context'; text: string }
  | { type: 'separator'; text: string };

export interface DiffSummary {
  /** Count of inserted lines (pre-truncation). */
  additions: number;
  /** Count of deleted lines (pre-truncation). */
  deletions: number;
  /** Ordered lines to render; may include `separator` markers between distant hunks. */
  lines: DiffLine[];
  /** True when the `oldText` input was undefined (new file). */
  isNewFile: boolean;
  /** True when the `newText` input was empty (full deletion). */
  isDeletion: boolean;
  /** True when the output was truncated; `lines` omits entries past the cap. */
  truncated: boolean;
  /** Total line count before truncation (sum of additions/deletions/context). */
  totalLines: number;
}

const CONTEXT_SIZE = 3;
const MAX_LINES = 200;

/**
 * Split a joined line-mode string (produced by `diff_charsToLines_`) into individual lines.
 * Preserves a trailing empty line if the text ends with `\n` only if it was an explicit empty line.
 */
function splitLines(text: string): string[] {
  if (text === '') return [];
  // `diff_charsToLines_` joins lines with their trailing newlines, so a block
  // "a\nb\n" should become ["a", "b"]. Strip exactly one trailing `\n` if present.
  const stripped = text.endsWith('\n') ? text.slice(0, -1) : text;
  return stripped.split('\n');
}

type LineOp = { type: 'add' | 'remove' | 'context'; text: string };

/** Compute line-level diff ops. Uses diff-match-patch in line mode. */
function lineDiff(oldText: string, newText: string): LineOp[] {
  const dmp = new diff_match_patch();
  const a = dmp.diff_linesToChars_(oldText, newText);
  const diffs = dmp.diff_main(a.chars1, a.chars2, false);
  dmp.diff_charsToLines_(diffs, a.lineArray);
  dmp.diff_cleanupSemantic(diffs);

  const ops: LineOp[] = [];
  for (const [op, text] of diffs) {
    const lines = splitLines(text);
    if (op === diff_match_patch.DIFF_EQUAL) {
      for (const l of lines) ops.push({ type: 'context', text: l });
    } else if (op === diff_match_patch.DIFF_DELETE) {
      for (const l of lines) ops.push({ type: 'remove', text: l });
    } else if (op === diff_match_patch.DIFF_INSERT) {
      for (const l of lines) ops.push({ type: 'add', text: l });
    }
  }
  return ops;
}

/**
 * Reduce a full line-op list to hunks of changed lines plus surrounding context.
 * Inserts `separator` markers between distant hunks.
 */
function applyContextWindow(ops: LineOp[], contextSize: number): DiffLine[] {
  const isChange = (o: LineOp) => o.type === 'add' || o.type === 'remove';

  // Find index ranges that should be kept: expand each change by contextSize on both sides.
  const keep = new Array(ops.length).fill(false);
  for (let i = 0; i < ops.length; i++) {
    if (isChange(ops[i])) {
      const start = Math.max(0, i - contextSize);
      const end = Math.min(ops.length - 1, i + contextSize);
      for (let j = start; j <= end; j++) keep[j] = true;
    }
  }

  const out: DiffLine[] = [];
  let inHunk = false;
  let seenAnyChange = false;
  for (let i = 0; i < ops.length; i++) {
    if (keep[i]) {
      if (!inHunk && seenAnyChange) {
        out.push({ type: 'separator', text: '\u2026' });
      }
      out.push(ops[i]);
      inHunk = true;
      if (isChange(ops[i])) seenAnyChange = true;
    } else {
      inHunk = false;
    }
  }
  return out;
}

/** Truncate a diff line list to `MAX_LINES` entries with a trailing summary marker. */
function truncateLines(lines: DiffLine[], total: number): { lines: DiffLine[]; truncated: boolean } {
  if (lines.length <= MAX_LINES) return { lines, truncated: false };
  const kept = lines.slice(0, MAX_LINES);
  const omitted = total - MAX_LINES;
  kept.push({ type: 'separator', text: `\u2026 ${omitted} more line${omitted === 1 ? '' : 's'}` });
  return { lines: kept, truncated: true };
}

/**
 * Compute a unified diff between `oldText` and `newText` suitable for rendering.
 *
 * Behavior:
 * - `oldText === undefined` → treated as a new file (all lines are `add`).
 * - `newText === ''` → treated as a full deletion (all lines are `remove`).
 * - Otherwise: line-level diff with {@link CONTEXT_SIZE} lines of context around
 *   changes and `separator` markers between distant hunks.
 * - Results longer than {@link MAX_LINES} are truncated with a trailing summary.
 */
export function computeUnifiedDiff(
  oldText: string | undefined,
  newText: string,
): DiffSummary {
  // New file
  if (oldText === undefined || oldText === null) {
    const raw = newText.length === 0 ? [] : newText.split('\n');
    const lines: DiffLine[] = raw.map((t) => ({ type: 'add', text: t }));
    const truncated = truncateLines(lines, lines.length);
    return {
      additions: raw.length,
      deletions: 0,
      lines: truncated.lines,
      isNewFile: true,
      isDeletion: false,
      truncated: truncated.truncated,
      totalLines: raw.length,
    };
  }

  // Full deletion
  if (newText === '') {
    const raw = oldText.length === 0 ? [] : oldText.split('\n');
    const lines: DiffLine[] = raw.map((t) => ({ type: 'remove', text: t }));
    const truncated = truncateLines(lines, lines.length);
    return {
      additions: 0,
      deletions: raw.length,
      lines: truncated.lines,
      isNewFile: false,
      isDeletion: true,
      truncated: truncated.truncated,
      totalLines: raw.length,
    };
  }

  // Identical content → no diff
  if (oldText === newText) {
    return {
      additions: 0,
      deletions: 0,
      lines: [],
      isNewFile: false,
      isDeletion: false,
      truncated: false,
      totalLines: 0,
    };
  }

  const ops = lineDiff(oldText, newText);
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === 'add') additions++;
    else if (op.type === 'remove') deletions++;
  }
  const hunked = applyContextWindow(ops, CONTEXT_SIZE);
  const truncated = truncateLines(hunked, hunked.length);
  return {
    additions,
    deletions,
    lines: truncated.lines,
    isNewFile: false,
    isDeletion: false,
    truncated: truncated.truncated,
    totalLines: hunked.length,
  };
}
