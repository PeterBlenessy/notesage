import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";

// ---------------------------------------------------------------------------
// Annotation serialization helpers (Task #12)
// ---------------------------------------------------------------------------

/**
 * Regex matching `{emoji}` prefix immediately after a list item marker.
 * Supports bullet (`- `, `* `, `+ `), ordered (`1. `), and task (`- [ ] `)
 * list items. Indented items (nested lists) are supported via `[ \t]*`.
 *
 * Captured groups:
 *   1. Full list marker + optional task checkbox (e.g. `- `, `- [x] `)
 *   2. The content inside braces (the emoji / annotation icon)
 */
const ANNOTATION_PREFIX_RE =
  /^([ \t]*(?:[*+-]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?)\{(.+?)\}[ \t]?/gm;

/**
 * Strip `{emoji}` prefixes from markdown list items and collect an ordered
 * map of list-item-index → emoji for later application to ProseMirror nodes.
 *
 * Returns:
 *   - `cleaned`: markdown with all `{emoji}` prefixes removed
 *   - `annotations`: Map<itemIndex, emoji> (0-based, document order)
 */
function stripAnnotationsFromMarkdown(markdown: string): {
  cleaned: string;
  annotations: Map<number, string>;
} {
  const annotations = new Map<number, string>();

  // Collect ALL list marker positions in document order
  const allMarkerPositions: number[] = [];
  for (const m of markdown.matchAll(
    /^[ \t]*(?:[*+-]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?/gm
  )) {
    allMarkerPositions.push(m.index ?? 0);
  }

  // Find annotated markers and map them to their global list-item index
  ANNOTATION_PREFIX_RE.lastIndex = 0;
  for (const m of markdown.matchAll(ANNOTATION_PREFIX_RE)) {
    const offset = m.index ?? 0;
    const emoji = m[2];
    const idx = allMarkerPositions.indexOf(offset);
    if (idx >= 0) {
      annotations.set(idx, emoji);
    }
  }

  // Strip `{emoji} ` from the text (keep marker, remove annotation)
  const cleaned = markdown.replace(
    ANNOTATION_PREFIX_RE,
    (_match, prefix: string) => prefix
  );

  return { cleaned, annotations };
}

/**
 * Apply collected annotations (from `stripAnnotationsFromMarkdown`) to the
 * ProseMirror document after content has been set.
 *
 * Dispatches a single transaction with `addToHistory: false` so the initial
 * load doesn't pollute the undo stack.
 */
export function applyAnnotationsToEditor(
  editor: Editor,
  annotations: Map<number, string>
): void {
  if (annotations.size === 0) return;

  const { state } = editor;
  const tr = state.tr.setMeta("addToHistory", false);
  let itemIndex = 0;
  let modified = false;

  state.doc.descendants((node, pos) => {
    if (node.type.name !== "listItem" && node.type.name !== "taskItem") return;
    const icon = annotations.get(itemIndex);
    itemIndex++;
    if (!icon) return;
    tr.setNodeAttribute(pos, "annotation", JSON.stringify({ icon }));
    modified = true;
  });

  if (modified) {
    editor.view.dispatch(tr);
  }
}

/**
 * After serialising markdown from the editor, inject `{emoji} ` prefixes
 * into list item lines by walking the ProseMirror document to collect
 * which items have annotations, in document order.
 *
 * The ProseMirror document order and the markdown list-item order match 1:1
 * for non-pathological documents.
 */
export function injectAnnotationsIntoMarkdown(
  markdown: string,
  editor: Editor
): string {
  // Collect icon per list item, in document order
  const icons: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== "listItem" && node.type.name !== "taskItem") return;
    const raw: unknown = node.attrs.annotation;
    let icon = "";
    if (typeof raw === "string" && raw) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          parsed !== null &&
          typeof parsed === "object" &&
          "icon" in parsed &&
          typeof (parsed as Record<string, unknown>).icon === "string"
        ) {
          icon = (parsed as { icon: string }).icon;
        }
      } catch {
        // Expected: annotation attr may contain invalid JSON from corrupted state
      }
    }
    icons.push(icon);
  });

  if (icons.every((i) => i === "")) return markdown;

  // Match every list item marker line and inject the corresponding icon
  let itemIndex = 0;
  return markdown.replace(
    /^([ \t]*(?:[*+-]|\d+\.)[ \t]+(?:\[[ xX]\][ \t]+)?)/gm,
    (match) => {
      const icon = icons[itemIndex] ?? "";
      itemIndex++;
      return icon ? `${match}{${icon}} ` : match;
    }
  );
}

// ---------------------------------------------------------------------------
// Task list normalization
// ---------------------------------------------------------------------------

/**
 * Normalize empty task list items so they survive round-tripping.
 *
 * `markdown-it-task-lists` requires a space after the checkbox bracket
 * (e.g. `[ ] ` not `[ ]`). Empty task items serialize to `- [ ]` with no
 * trailing content — the trailing space may be stripped during save. On
 * reload, the parser fails to recognize them and they render as raw `[ ]`
 * text inside a bullet list item.
 *
 * This function ensures every checkbox bracket has at least one trailing
 * space so the parser always matches.
 */
function normalizeEmptyTaskItems(markdown: string): string {
  // Match task items where the checkbox bracket is the last thing on the line
  // (no content after it). Add a trailing space so markdown-it-task-lists matches.
  return markdown.replace(
    /^([ \t]*[-+*][ \t]+\[[ xX]\])$/gm,
    "$1 ",
  );
}

// ---------------------------------------------------------------------------
// Ghost task item cleanup
// ---------------------------------------------------------------------------

/**
 * Remove ghost empty task items and fix corrupted bracket escaping.
 *
 * ProseMirror can create invisible empty task items (Tiptap "Bullet List
 * Limbo" — issue #3128). These serialize as `- [ ]` or `- [ ] ` lines.
 * When they appear adjacent to regular bullet items, subsequent round-trips
 * corrupt the list: `markdown-it-task-lists` marks the parent `<ul>` as a
 * task list, plain `<li>` children get mis-parsed, and `[ ]` text content
 * is escaped to `\[ \]` by prosemirror-markdown. Each cycle adds another
 * ghost item and more escaped brackets.
 *
 * This function:
 * 1. Removes ALL empty task items (no content after checkbox) — these are
 *    ProseMirror ghosts, not user content.
 * 2. Converts `- \[ \]` (escaped brackets from previous corruption) back
 *    to regular bullet items `- ` to prevent further accumulation.
 * 3. Cleans up blank lines left behind by removed items.
 */
export function stripGhostTaskItems(markdown: string): string {
  const lines = markdown.split("\n");
  const listItemRe = /^[ \t]*(?:[-+*]|\d+\.)[ \t]+/;
  const emptyTaskItemRe = /^[ \t]*[-+*][ \t]+\[[ xX]\][ \t]*$/;
  const escapedBracketsRe = /^[ \t]*[-+*][ \t]+\\?\[[ \t]?\\?\][ \t]*$/;

  // Identify consecutive list-item runs, then strip ghost items from
  // the tail of each run. Ghost items are: empty task items (`- [ ]`)
  // and corrupted escaped-bracket items (`- \[ \]`).
  const remove = new Set<number>();

  let i = 0;
  while (i < lines.length) {
    // Find the start of a list-item run
    if (!listItemRe.test(lines[i])) {
      i++;
      continue;
    }

    // Walk to the end of this run (consecutive list items + blank lines between)
    const runStart = i;
    while (i < lines.length && (listItemRe.test(lines[i]) || lines[i].trim() === "")) {
      i++;
    }
    // runEnd is exclusive; trim trailing blank lines from the run
    let runEnd = i;
    while (runEnd > runStart && lines[runEnd - 1].trim() === "") {
      runEnd--;
    }

    // Walk backwards within the run to find trailing ghost items
    for (let j = runEnd - 1; j >= runStart; j--) {
      const line = lines[j];
      if (line.trim() === "") continue;
      if (emptyTaskItemRe.test(line) || escapedBracketsRe.test(line)) {
        remove.add(j);
        continue;
      }
      // Non-ghost list item — stop stripping
      break;
    }
  }

  if (remove.size === 0) return markdown;

  // Remove ghost lines and collapse double blank lines left behind
  const result: string[] = [];
  for (let k = 0; k < lines.length; k++) {
    if (remove.has(k)) continue;
    // Avoid double blank lines from removed items
    if (lines[k].trim() === "" && result.length > 0 && result[result.length - 1].trim() === "") {
      continue;
    }
    result.push(lines[k]);
  }
  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Callout preprocessing
// ---------------------------------------------------------------------------

/**
 * Valid callout types (case-insensitive match).
 */
const VALID_CALLOUT_TYPES = new Set(["note", "tip", "warning", "important"]);

/**
 * Convert Obsidian-style callout syntax (`> [!type]`) to HTML `<div>` elements
 * before tiptap-markdown parses the content. This ensures callout blocks are
 * recognized as `Callout` nodes instead of plain blockquotes.
 *
 * Regular blockquotes starting with `[!` but with an invalid type are left
 * as plain blockquotes.
 */
export function convertCalloutsToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Check for a callout start: `> [!type]` or `> [!type] Title`
    const headerMatch = lines[i].match(
      /^>\s*\[!(\w+)\](?:\s+(.+))?$/
    );

    if (headerMatch) {
      const type = headerMatch[1].toLowerCase();
      const title = headerMatch[2]?.trim() || null;

      if (VALID_CALLOUT_TYPES.has(type)) {
        // Collect all continuation lines (lines starting with `>`)
        const bodyLines: string[] = [];
        i++;
        while (i < lines.length && /^>/.test(lines[i])) {
          // Strip the leading `> ` or `>` prefix
          const content = lines[i].replace(/^>\s?/, "");
          bodyLines.push(content);
          i++;
        }

        // Build HTML div for tiptap-markdown to parse
        const titleAttr = title ? ` data-title="${title.replace(/"/g, "&quot;")}"` : "";
        const bodyHtml = bodyLines.length > 0
          ? bodyLines
              .map((line) => (line.trim() === "" ? "</p><p>" : escapeHtml(line)))
              .join("\n")
          : "";

        result.push(
          `<div class="callout callout-${type}" data-callout-type="${type}"${titleAttr}>`,
          `<p>${bodyHtml}</p>`,
          `</div>`,
          ""
        );
        continue;
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join("\n");
}

/**
 * Minimal HTML entity escaping for callout body text.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Link preview preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert link preview blockquote syntax (`> [!link](url)`) to HTML
 * `<div data-link-preview>` elements before tiptap-markdown parses the content.
 *
 * Format:
 * ```
 * > [!link](https://example.com)
 * > **Title**
 * > Description text
 * > site.com
 * ```
 *
 * The `[!link]` marker distinguishes these from callouts (`[!note]`, etc.)
 * and regular blockquotes.
 */
export function convertLinkPreviewsToHtml(markdown: string): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Match: > [!link](url)
    const headerMatch = lines[i].match(
      /^>\s*\[!link\]\((.+)\)\s*$/
    );

    if (headerMatch) {
      const url = headerMatch[1];
      let title: string | null = null;
      let description: string | null = null;
      let siteName: string | null = null;
      let imageUrl: string | null = null;
      let faviconUrl: string | null = null;

      // Collect continuation lines
      i++;
      const bodyLines: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        const content = lines[i].replace(/^>\s?/, "").trim();
        if (content) bodyLines.push(content);
        i++;
      }

      // Parse body lines: extract metadata comments, **bold** = title, rest = description/siteName
      for (const line of bodyLines) {
        // Hidden metadata: <!--image:url--> and <!--favicon:url-->
        const imageMatch = line.match(/^<!--image:(.+)-->$/);
        if (imageMatch) { imageUrl = imageMatch[1]; continue; }
        const faviconMatch = line.match(/^<!--favicon:(.+)-->$/);
        if (faviconMatch) { faviconUrl = faviconMatch[1]; continue; }

        const boldMatch = line.match(/^\*\*(.+)\*\*$/);
        if (boldMatch && !title) {
          title = boldMatch[1];
        } else if (siteName === null && description !== null) {
          siteName = line;
        } else if (description === null) {
          description = line;
        } else {
          if (siteName) {
            description += " " + siteName;
          }
          siteName = line;
        }
      }

      const attrs = [
        `data-link-preview="${escapeHtml(url)}"`,
        title ? `data-title="${escapeHtml(title)}"` : "",
        description ? `data-description="${escapeHtml(description)}"` : "",
        siteName ? `data-site-name="${escapeHtml(siteName)}"` : "",
        imageUrl ? `data-image-url="${escapeHtml(imageUrl)}"` : "",
        faviconUrl ? `data-favicon-url="${escapeHtml(faviconUrl)}"` : "",
      ].filter(Boolean).join(" ");

      result.push(`<div ${attrs}></div>`, "");
      continue;
    }

    result.push(lines[i]);
    i++;
  }

  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Drawing (Excalidraw) preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert Excalidraw image references to Drawing node HTML elements
 * before tiptap-markdown parses the content.
 *
 * Matches: ![drawing](/.notesage/drawings/abc123.excalidraw)
 * Outputs: <div data-drawing-id="abc123" data-type="drawing" class="drawing-block"></div>
 *
 * Regular images (non-.excalidraw) are left unchanged.
 */
export function convertDrawingsToHtml(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+\.excalidraw)\)/g,
    (_match, _alt: string, src: string) => {
      // Extract drawingId from path: /.notesage/drawings/abc123.excalidraw → abc123
      const filename = src.split("/").pop() || "";
      const drawingId = filename.replace(".excalidraw", "");
      return `<div data-drawing-id="${drawingId}" data-type="drawing" class="drawing-block"></div>`;
    },
  );
}

/**
 * Convert chart JSON image references to Chart node HTML elements
 * before tiptap-markdown parses the content.
 *
 * Matches: ![chart](/.notesage/charts/abc123.json)
 * Outputs: <div data-chart-id="abc123" data-type="chart" class="chart-block"></div>
 *
 * Regular images and other paths are left unchanged.
 */
export function convertChartsToHtml(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]*\/\.notesage\/charts\/[^)]+\.json)\)/g,
    (_match, _alt: string, src: string) => {
      const filename = src.split("/").pop() || "";
      const chartId = filename.replace(".json", "");
      return `<div data-chart-id="${chartId}" data-type="chart" class="chart-block"></div>`;
    },
  );
}

// ---------------------------------------------------------------------------
// Image path space encoding
// ---------------------------------------------------------------------------

/**
 * Encode spaces in local image paths so markdown-it can parse them.
 * CommonMark doesn't allow spaces in bare link/image destinations.
 * We encode them as %20 before parsing and decode on serialization
 * so the on-disk markdown is unchanged.
 */
export function encodeImagePathSpaces(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, dest: string) => {
      if (!dest.includes(" ")) return match;
      // Angle-bracket destinations are already valid with spaces
      if (dest.startsWith("<") && dest.endsWith(">")) return match;
      // Remote URLs and data URIs — leave as-is
      if (/^https?:\/\//.test(dest) || dest.startsWith("data:")) return match;
      // Split optional title: path "title" or path 'title'
      const titleMatch = dest.match(/^(.+?)(\s+["'].*["'])$/);
      if (titleMatch) {
        const path = titleMatch[1].replace(/ /g, "%20");
        return `![${alt}](${path}${titleMatch[2]})`;
      }
      return `![${alt}](${dest.replace(/ /g, "%20")})`;
    },
  );
}

/**
 * Decode %20 back to spaces in local image paths for saving.
 */
export function decodeImagePathSpaces(markdown: string): string {
  return markdown.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (match, alt, dest: string) => {
      if (!dest.includes("%20")) return match;
      if (/^https?:\/\//.test(dest) || dest.startsWith("data:")) return match;
      return `![${alt}](${dest.replace(/%20/g, " ")})`;
    },
  );
}

// ---------------------------------------------------------------------------
// Editor ↔ Markdown helpers
// ---------------------------------------------------------------------------

export function getMarkdownFromEditor(editor: Editor): string {
  let markdown = "";

  // Try to use the Markdown extension's getMarkdown method
  try {
    const markdownExt = editor.extensionManager.extensions.find(
      (ext) => ext.name === "markdown"
    );
    if (
      markdownExt &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (markdownExt as any).storage?.getMarkdown === "function"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      markdown = decodeImagePathSpaces((markdownExt as any).storage.getMarkdown());
    }
  } catch (error) {
    console.warn("Failed to get markdown from extension:", error);
  }

  // Fallback: try editor storage
  if (!markdown) {
    try {
      if (
        editor.storage &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        typeof (editor.storage as any).markdown?.getMarkdown === "function"
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        markdown = decodeImagePathSpaces((editor.storage as any).markdown.getMarkdown());
      }
    } catch (error) {
      console.warn("Failed to get markdown from storage:", error);
    }
  }

  // Last resort
  if (!markdown) {
    return editor.getText();
  }

  // Strip ghost empty task items and fix corrupted bracket escaping
  markdown = stripGhostTaskItems(markdown);

  // Inject {emoji} prefixes from the current ProseMirror document annotations
  return injectAnnotationsIntoMarkdown(markdown, editor);
}

export function setMarkdownInEditor(editor: Editor, markdown: string): void {
  setContentWithoutHistory(editor, encodeImagePathSpaces(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertCalloutsToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(markdown))))))));
}

/**
 * Replace the editor's document content without adding to undo history.
 * Accepts already-encoded content (after encodeImagePathSpaces).
 *
 * NOTE: For loading raw markdown that may contain `{emoji}` annotation
 * prefixes, use `loadRawMarkdownIntoEditor` instead.
 */
export function setContentWithoutHistory(editor: Editor, content: string): void {
  editor.chain().setMeta("addToHistory", false).setContent(content).run();
}

/**
 * Load raw markdown (as stored on disk) into the editor without adding to
 * undo history.
 *
 * This is the preferred function for loading tab content, external changes,
 * and any markdown that may contain `{emoji}` annotation prefixes. It:
 *   1. Strips `{emoji}` prefixes and collects the annotation map
 *   2. Encodes image path spaces
 *   3. Calls setContent
 *   4. Applies annotations via a follow-up transaction (next animation frame)
 */
export function loadRawMarkdownIntoEditor(
  editor: Editor,
  rawMarkdown: string
): void {
  const { cleaned, annotations } = stripAnnotationsFromMarkdown(rawMarkdown);
  const encoded = encodeImagePathSpaces(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertCalloutsToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(cleaned)))))));
  editor.chain().setMeta("addToHistory", false).setContent(encoded).run();

  // Clear undo/redo history — the loaded content is a fresh baseline.
  // Without this, stale history entries from the previous document cause
  // silent no-op undos and unexpected cursor jumps after tab switches.
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);

  if (annotations.size > 0) {
    requestAnimationFrame(() => {
      applyAnnotationsToEditor(editor, annotations);
    });
  }
}

/**
 * Prepare raw markdown for use as Tiptap's initial `content` option.
 * Strips annotation prefixes and encodes image paths. Returns the cleaned
 * string AND the annotation map (apply with `applyAnnotationsToEditor` after
 * the editor is created).
 */
export function prepareInitialContent(rawMarkdown: string): {
  content: string;
  annotations: Map<number, string>;
} {
  const { cleaned, annotations } = stripAnnotationsFromMarkdown(rawMarkdown);
  return { content: encodeImagePathSpaces(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertCalloutsToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(cleaned))))))), annotations };
}
