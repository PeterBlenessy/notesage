/**
 * Extensible paste-rule registry for the Tiptap editor.
 *
 * Why this exists (live-test 2026-04-25):
 *
 *   The default Tiptap paste path runs the markdown parser on every
 *   `text/plain` payload. That's correct when the user pastes actual
 *   markdown source, but it misfires for several real-world cases the
 *   user keeps hitting:
 *
 *     - iCloud paths like `/Users/.../com~apple~CloudDocs/...` — the
 *       `~apple~` lights up the Subscript mark and renders as
 *       `<sub>apple</sub>`. The user wants the literal path.
 *     - Prose copied from terminals or chat (e.g. an AI response) that
 *       happens to contain markdown-meaningful punctuation (`~text~`,
 *       `*foo*`, `_bar_`, backticks). The user wanted the prose, not the
 *       formatting it accidentally encodes.
 *
 *   Rather than disable individual marks (which would break legitimate
 *   markdown editing), we run pasted clipboard content through a
 *   prioritised list of rules. The first rule whose `test` matches AND
 *   whose `handle` returns true consumes the paste. Otherwise Tiptap's
 *   default markdown-paste path runs.
 *
 *   Rules are module-level so tests / future features can register or
 *   unregister them without re-mounting the editor. Built-in rules
 *   (currently: `filePathPasteRule`) are auto-registered on module
 *   load; downstream code calls `registerPasteRule` to add more.
 */

import type { EditorView } from "@tiptap/pm/view";

export interface PasteRuleContext {
  /** Raw clipboard payload. */
  clipboardData: DataTransfer;
  /** Best-effort `text/plain` (empty string if absent). */
  text: string;
  /** `text/html` if present, otherwise null. */
  html: string | null;
  /** ProseMirror view (for dispatching transactions). */
  view: EditorView;
  /** Original ClipboardEvent — call `preventDefault()` to swallow the default paste. */
  event: ClipboardEvent;
}

export interface PasteRule {
  /** Stable identifier — used for debugging and test assertions. */
  name: string;
  /**
   * Higher numbers run first. Built-in rules use 100 (file path),
   * 50 (mid-priority defaults). User rules default to 0.
   */
  priority?: number;
  /**
   * Cheap predicate: should this rule consider the paste? Keep this
   * fast (regex / startsWith) — it runs on every paste.
   */
  test: (ctx: PasteRuleContext) => boolean;
  /**
   * Perform the paste. Return true if the paste is now consumed and
   * Tiptap should NOT run its default markdown-paste path. Return
   * false to fall through to the next rule (or to Tiptap default).
   *
   * The handler is responsible for `event.preventDefault()` AND
   * dispatching whatever transaction it wants (e.g. `insertText`).
   */
  handle: (ctx: PasteRuleContext) => boolean;
}

const rules: PasteRule[] = [];

function sortRules() {
  rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

/**
 * Register a paste rule. Returns an unsubscribe function. Rules are
 * sorted by descending priority every time the registry changes.
 */
export function registerPasteRule(rule: PasteRule): () => void {
  rules.push(rule);
  sortRules();
  return () => {
    const idx = rules.indexOf(rule);
    if (idx >= 0) rules.splice(idx, 1);
  };
}

/** Read-only view of the current rule list (sorted, highest priority first). */
export function getPasteRules(): readonly PasteRule[] {
  return rules;
}

/** Test-only — wipes the registry between tests. */
export function __clearPasteRulesForTesting(): void {
  rules.length = 0;
}

// ===========================================================================
// Built-in rules
// ===========================================================================

/**
 * Detects pasted file paths and inserts them as literal text.
 *
 * Triggers on text that looks unambiguously like a path:
 *   - POSIX absolute (`/Users/...`)
 *   - Home-relative (`~/Documents/...`)
 *   - Relative (`./foo`, `../bar`)
 *   - Windows drive (`C:\Users\...` or `C:/Users/...`)
 *
 * Strips a single layer of surrounding quotes (Finder's "Copy as
 * Pathname" wraps in `'...'`) and inserts the result via
 * `tr.insertText`, which goes through ProseMirror as plain text and
 * never hits the markdown parser.
 */
export const filePathPasteRule: PasteRule = {
  name: "file-path",
  priority: 100,
  test: (ctx) => looksLikePath(ctx.text),
  handle: (ctx) => {
    const literal = stripSurroundingQuotes(ctx.text.trim());
    ctx.event.preventDefault();
    ctx.view.dispatch(ctx.view.state.tr.insertText(literal));
    return true;
  },
};

const PATH_PATTERN =
  /^['"]?(\/|~(\/|$)|\.{1,2}\/|[A-Za-z]:[\\/])[^\n]*['"]?$/;

/**
 * True when `text` looks like a single-line file path. Multi-line input
 * is rejected — paths don't span lines, and a multi-line paste is much
 * more likely to be document content the user actually wants parsed.
 */
export function looksLikePath(text: string): boolean {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.includes("\n")) return false;
  return PATH_PATTERN.test(trimmed);
}

function stripSurroundingQuotes(text: string): string {
  if (text.length < 2) return text;
  const first = text[0];
  const last = text[text.length - 1];
  if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * Detects pasted preformatted/terminal output and inserts it inside a
 * fenced code block so its whitespace and column alignment survive.
 *
 * Triggers on text containing Unicode box-drawing characters (the
 * `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ━ ┃ ╔ ╗ …` family used by `cli-table`,
 * `boxen`, `prettyTable`, GitHub Actions logs, etc.). These are an
 * unambiguous "this is preformatted ASCII art" signal — they have no
 * legitimate use in flowing prose.
 *
 * The rule wraps the entire pasted block in a triple-backtick fence
 * with no language tag, so the editor renders it monospace + preserves
 * the column alignment that gives the table its readability.
 */
export const preformattedTextPasteRule: PasteRule = {
  name: "preformatted-text",
  priority: 80,
  test: (ctx) => looksLikePreformatted(ctx.text),
  handle: (ctx) => {
    const text = ctx.text.replace(/\r\n?/g, "\n");
    ctx.event.preventDefault();
    // Insert a code_block node containing the literal text. We can't use
    // `tr.insertText` (it would split into paragraphs); we build the node
    // explicitly via the schema so the fence is a single block.
    const { state } = ctx.view;
    const codeBlockType = state.schema.nodes.codeBlock;
    if (!codeBlockType) {
      // Schema doesn't have a code block — fall back to plain text.
      ctx.view.dispatch(ctx.view.state.tr.insertText(text));
      return true;
    }
    const node = codeBlockType.create(null, state.schema.text(text));
    ctx.view.dispatch(state.tr.replaceSelectionWith(node));
    return true;
  },
};

const BOX_DRAWING_CHARS =
  /[─-╿▀-▟▖-▟■-◿▖-□]/;

/**
 * True when `text` contains a meaningful number of Unicode box-drawing
 * characters — the unambiguous signal that the source was a terminal-
 * rendered table or ASCII-art block.
 *
 * The threshold (>= 4 box-drawing chars) avoids false positives on the
 * occasional standalone bullet `•` or stray `─` while catching even a
 * 2-row, 1-column table (which has at least 7 box-drawing chars).
 */
export function looksLikePreformatted(text: string): boolean {
  if (typeof text !== "string") return false;
  if (text.length === 0) return false;
  // Quick gate — the regex is cheap but skip the global match unless
  // we know there's at least one candidate.
  if (!BOX_DRAWING_CHARS.test(text)) return false;
  const matches = text.match(new RegExp(BOX_DRAWING_CHARS, "g"));
  return matches !== null && matches.length >= 4;
}

// ---------------------------------------------------------------------------
// Auto-registration of built-in rules on module load.
//
// Done at module load (rather than via an explicit `registerBuiltInRules()`
// call from app entry) so the rule is active everywhere the editor loads —
// including future surfaces (PDF annotations, comment composer, etc.) —
// without each entry point needing to remember to call the registration
// helper.
// ---------------------------------------------------------------------------
registerPasteRule(filePathPasteRule);
registerPasteRule(preformattedTextPasteRule);
