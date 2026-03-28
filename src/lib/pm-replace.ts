import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { CommentMarkPluginKey } from "@/components/editor/extensions/comment-mark";
import type { Comment } from "@/stores/comment-store";
import { getEditorStorage, type EditorStorageMarkdown } from "@/lib/editor-storage";

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
    const mdStorage = getEditorStorage<EditorStorageMarkdown>(editor, 'markdown');
    if (!mdStorage?.parser) return null;

    const html = mdStorage.parser.parse(markdown);
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
    // Expected: markdown parser may be unavailable or fail on malformed input
    return null;
  }
}

/**
 * Parse a markdown string to full HTML using the editor's tiptap-markdown parser.
 * Unlike `parseMarkdownToHtml`, this returns the complete HTML output including
 * block-level elements (paragraphs, tables, code blocks, lists, etc.).
 * Used for AI suggestion previews and full-content replacement.
 * Returns null if the parser is unavailable or parsing fails.
 */
export function parseMarkdownToHtmlFull(
  editor: Editor,
  markdown: string
): string | null {
  try {
    const mdStorage = getEditorStorage<EditorStorageMarkdown>(editor, 'markdown');
    if (!mdStorage?.parser) return null;

    const html = mdStorage.parser.parse(markdown);
    if (typeof html !== "string" || !html.trim()) return null;

    return html;
  } catch {
    // Expected: markdown parser may be unavailable or fail on malformed input
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

/**
 * Strip AI preamble ("Here's the improved version:", "Sure!", etc.)
 * and trailing sign-offs ("Let me know if...") from agent response text.
 */
export function extractReplacementText(response: string): string {
  let text = response.trim();

  // Strip leading preamble lines (common AI intro patterns)
  const preamblePatterns = [
    /^(?:here(?:'s| is) (?:the |an? |my )?(?:improved|updated|revised|corrected|rewritten|edited|suggested|new) (?:version|text|content|passage|paragraph|wording)[^:]*?:?\s*)/i,
    /^(?:sure[!,.]?\s*(?:here(?:'s| is)[^:]*?:?\s*)?)/i,
    /^(?:certainly[!,.]?\s*(?:here(?:'s| is)[^:]*?:?\s*)?)/i,
    /^(?:of course[!,.]?\s*(?:here(?:'s| is)[^:]*?:?\s*)?)/i,
    /^(?:absolutely[!,.]?\s*(?:here(?:'s| is)[^:]*?:?\s*)?)/i,
    /^(?:i(?:'ve| have) (?:improved|updated|revised|rewritten|edited)[^:]*?:?\s*)/i,
  ];

  for (const pattern of preamblePatterns) {
    text = text.replace(pattern, '');
  }

  // Strip trailing sign-offs
  const signoffPatterns = [
    /\n+(?:let me know if (?:you(?:'d| would) like|this|that|there)[^\n]*?)$/i,
    /\n+(?:feel free to (?:ask|let me know|reach out)[^\n]*?)$/i,
    /\n+(?:i(?:'m| am) happy to (?:help|make|adjust)[^\n]*?)$/i,
    /\n+(?:would you like (?:me to|any)[^\n]*?)$/i,
  ];

  for (const pattern of signoffPatterns) {
    text = text.replace(pattern, '');
  }

  return text.trim();
}

/**
 * Resolve the current document position of a comment's anchor text.
 * Strategy 1: use CommentMark plugin state (decorations remapped through ProseMirror mapping).
 * Strategy 2: fallback text search via doc.descendants().
 * Returns null if the anchor text was deleted.
 */
export function resolveAnchorRange(
  editor: Editor,
  comment: Comment
): { from: number; to: number } | null {
  // Strategy 1: decoration positions from CommentMark plugin
  const pluginState = CommentMarkPluginKey.getState(editor.state);
  if (pluginState) {
    const match = pluginState.comments.find(
      (c: { commentId: string; from: number; to: number }) => c.commentId === comment.id
    );
    if (match && match.from < match.to) {
      return { from: match.from, to: match.to };
    }
  }

  // Strategy 2: text search fallback
  const target = comment.anchorText;
  if (!target) return null;

  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (node.isText && node.text) {
      const idx = node.text.indexOf(target);
      if (idx !== -1) {
        found = { from: pos + idx, to: pos + idx + target.length };
        return false;
      }
    }
    return true;
  });

  return found;
}
