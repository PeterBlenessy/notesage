/**
 * Candidate action-item pre-filter.
 *
 * A cheap, synchronous, client-side gate that decides whether a single line of
 * text looks enough like an action item to be worth sending to a model for
 * refinement. The goal is to ensure ordinary prose, headings, and structural
 * markdown NEVER reach a model call.
 *
 * Conservative by design: when in doubt, return false. Wasting a model call on
 * prose is worse than missing the occasional borderline action item.
 *
 * Pure and fast — no async, no I/O, no dependencies on the rest of the feature.
 */

/**
 * Curated set of base-form imperative verbs that commonly begin an action item.
 * Exported so callers can test against it or extend it.
 *
 * All entries are lower-case; matching is case-insensitive.
 */
export const IMPERATIVE_VERBS: ReadonlySet<string> = new Set([
  "add",
  "fix",
  "write",
  "update",
  "review",
  "send",
  "call",
  "email",
  "follow",
  "ask",
  "check",
  "create",
  "build",
  "refactor",
  "remove",
  "schedule",
  "draft",
  "investigate",
  "look",
  "ping",
  "contact",
  "finish",
  "ship",
  "test",
  "deploy",
  "document",
  "plan",
  "organize",
  "organise",
  "prepare",
  "fill",
  "set",
  "make",
  "move",
  "rename",
  "delete",
  "merge",
  "publish",
  "verify",
  "confirm",
  "reply",
  "respond",
  "submit",
  "upload",
  "download",
  "implement",
  "design",
  "research",
  "read",
  "buy",
  "book",
  "order",
  "pay",
  "renew",
  "cancel",
  "clean",
  "sort",
  "tidy",
  "track",
]);

/** Matches a GFM task-list checkbox marker (checked or unchecked), with optional leading indent. */
const TASK_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]\s*/;

/** Matches a leading bullet list marker (`-`, `*`, `+`, or ordered `1.` / `1)`), with optional indent. */
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** Matches an ATX heading (`#`…`######`). */
const HEADING_RE = /^\s*#{1,6}(?:\s|$)/;

/** Matches a blockquote line. */
const BLOCKQUOTE_RE = /^\s*>/;

/** Matches a fenced code block delimiter (``` or ~~~). */
const CODE_FENCE_RE = /^\s*(?:```|~~~)/;

/** Matches a markdown table row (leading pipe). */
const TABLE_ROW_RE = /^\s*\|/;

/** Matches a horizontal rule (---, ***, ___ with 3+ chars). */
const HORIZONTAL_RULE_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

/** Matches a leading TODO / FIXME marker (optionally with a colon). */
const TODO_FIXME_RE = /^(?:TODO|FIXME)\b:?/i;

/**
 * Extract the first word of a string, stripping surrounding punctuation.
 * Returns the lower-cased word, or an empty string if none.
 */
function firstWord(text: string): string {
  const trimmed = text.trimStart();
  const match = trimmed.match(/^[A-Za-z]+/);
  return match ? match[0].toLowerCase() : "";
}

/**
 * Returns true if the given single line of text looks like an action item
 * worth refining, false for prose, headings, structural markdown, or empty lines.
 *
 * @param lineText A single line of text (no embedded newlines expected).
 */
export function isActionCandidate(lineText: string): boolean {
  // Empty / whitespace-only.
  if (lineText.trim().length === 0) return false;

  // Structural markdown that is never an action item.
  // Horizontal rules and table rows are checked before the list-marker logic
  // because `---` and `|` would otherwise slip through.
  if (HORIZONTAL_RULE_RE.test(lineText)) return false;
  if (HEADING_RE.test(lineText)) return false;
  if (BLOCKQUOTE_RE.test(lineText)) return false;
  if (CODE_FENCE_RE.test(lineText)) return false;
  if (TABLE_ROW_RE.test(lineText)) return false;

  // GFM task-list items are always candidates.
  if (TASK_ITEM_RE.test(lineText)) return true;

  // Strip a leading list/checkbox marker (if any) before testing the body.
  const body = lineText.replace(LIST_MARKER_RE, "");

  // TODO / FIXME markers (at the start of the body) are candidates.
  if (TODO_FIXME_RE.test(body.trimStart())) return true;

  // Imperative-leading lines: the first word is a base-form imperative verb.
  // Only the leading position counts — an imperative verb mid-sentence does not trigger.
  return IMPERATIVE_VERBS.has(firstWord(body));
}
