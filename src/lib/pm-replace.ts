import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

/**
 * Parse a markdown string to inline HTML using the editor's tiptap-markdown parser.
 * Strips outer `<p>` wrappers so the result can be inserted inline via `insertContentAt`.
 * Returns null if the parser is unavailable, parsing fails, or the text has no formatting.
 */
export function parseMarkdownToHtml(
  editor: Editor,
  markdown: string
): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mdStorage = (editor.storage as any).markdown as
      | Record<string, unknown>
      | undefined;
    const parser = mdStorage?.parser as
      | { parse: (content: string) => string }
      | undefined;
    if (!parser) return null;

    const html = parser.parse(markdown);
    if (typeof html !== "string") return null;

    // Strip <p> wrappers — we need inline HTML for insertContentAt.
    // The markdown parser wraps everything in <p> tags; inserting block-level
    // content via insertContentAt inside an existing paragraph breaks rendering.
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;

    // Only use HTML if it contains actual formatting tags (strong, em, code, a, etc.).
    // Plain text should fall through to insertContentAt's default text path
    // which preserves positional marks via tr.insertText.
    const hasFormatting = wrapper.querySelector("strong, em, code, a, del, s, u, sub, sup, mark") !== null;
    if (!hasFormatting) return null;

    // Extract innerHTML from the first <p> only — inline content for insertion.
    // Multi-paragraph responses are handled as plain text by the fallback path.
    const firstP = wrapper.querySelector("p");
    if (!firstP) return null;

    return firstP.innerHTML;
  } catch {
    return null;
  }
}

/**
 * Replace a range in a transaction while preserving ProseMirror marks.
 *
 * Uses `tr.insertText` which inherits marks from the resolved position.
 * This is the correct approach for plain-text replacements (e.g., diff hunks)
 * where the text itself has no markdown formatting but should inherit surrounding marks.
 *
 * For text that contains markdown syntax (e.g., AI suggestions with `**bold**`),
 * use `parseMarkdownToHtml` + Tiptap's `insertContentAt` chain API instead.
 */
export function replaceRangePreservingMarks(
  _editor: Editor,
  tr: Transaction,
  from: number,
  to: number,
  text: string
): void {
  // Pure deletion
  if (!text) {
    tr.delete(from, to);
    return;
  }

  // tr.insertText inherits marks from doc.resolve(from).marks()
  if (from === to) {
    tr.insertText(text, from);
  } else {
    tr.insertText(text, from, to);
  }
}
