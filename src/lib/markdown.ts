import type { Editor } from "@tiptap/core";
import {
  getEditorStorage,
  type EditorStorageMarkdown,
} from "@/lib/editor-storage";
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
/**
 * @workerSafe Pure regex transform — exported so the markdown-parse Web Worker
 * (Phase 2) can extract annotations off the main thread.
 */
export function stripAnnotationsFromMarkdown(markdown: string): {
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

  editor.chain().command(({ tr, state }) => {
    tr.setMeta("addToHistory", false);
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

    return modified;
  }).run();
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
/** @workerSafe Pure regex transform — exported for Phase 2 worker pipeline. */
export function normalizeEmptyTaskItems(markdown: string): string {
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

      let blockWidth: string | null = null;
      let align: string | null = null;

      // Parse body lines: extract metadata comments, **bold** = title, rest = description/siteName
      for (const line of bodyLines) {
        // Hidden metadata: <!--image:url--> and <!--favicon:url-->
        const imageMatch = line.match(/^<!--image:(.+)-->$/);
        if (imageMatch) { imageUrl = imageMatch[1]; continue; }
        const faviconMatch = line.match(/^<!--favicon:(.+)-->$/);
        if (faviconMatch) { faviconUrl = faviconMatch[1]; continue; }

        // Hidden metadata: <!--blockWidth:N--> <!--align:X--> <!--blockWidth:N,align:X-->
        const blockMeta = line.match(/^<!--(blockWidth:\d+|align:(?:left|center|right)|blockWidth:\d+,align:(?:left|center|right)|align:(?:left|center|right),blockWidth:\d+)-->$/);
        if (blockMeta) {
          const meta = blockMeta[1];
          const bwMatch = meta.match(/blockWidth:(\d+)/);
          if (bwMatch) blockWidth = bwMatch[1];
          const alMatch = meta.match(/align:(left|center|right)/);
          if (alMatch) align = alMatch[1];
          continue;
        }

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
        blockWidth ? `data-block-width="${blockWidth}"` : "",
        align ? `data-align="${align}"` : "",
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
    // Optional trailing `<!--blockWidth:N,align:X-->` carries width/align metadata
    // for sidecar drawings that haven't been auto-migrated to inline form.
    /!\[([^\]]*)\]\(([^)]+\.excalidraw)\)(?:\s*<!--((?:blockWidth:\d+|align:(?:left|center|right))(?:,(?:blockWidth:\d+|align:(?:left|center|right)))?)-->)?/g,
    (_match, _alt: string, src: string, meta?: string) => {
      const filename = src.split("/").pop() || "";
      const drawingId = filename.replace(".excalidraw", "");
      const blockWidth = meta?.match(/blockWidth:(\d+)/)?.[1];
      const align = meta?.match(/align:(left|center|right)/)?.[1];
      const blockWidthAttr = blockWidth
        ? ` data-block-width="${blockWidth}"`
        : "";
      const alignAttr = align ? ` data-align="${align}"` : "";
      return `<div data-drawing-id="${drawingId}" data-type="drawing" class="drawing-block"${blockWidthAttr}${alignAttr}></div>`;
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
    // Optional trailing `<!--blockWidth:N,align:X-->` carries width/align metadata
    // for sidecar charts that haven't been auto-migrated to inline form.
    /!\[([^\]]*)\]\(([^)]*\/\.notesage\/charts\/[^)]+\.json)\)(?:\s*<!--((?:blockWidth:\d+|align:(?:left|center|right))(?:,(?:blockWidth:\d+|align:(?:left|center|right)))?)-->)?/g,
    (_match, _alt: string, src: string, meta?: string) => {
      const filename = src.split("/").pop() || "";
      const chartId = filename.replace(".json", "");
      const blockWidth = meta?.match(/blockWidth:(\d+)/)?.[1];
      const align = meta?.match(/align:(left|center|right)/)?.[1];
      const blockWidthAttr = blockWidth
        ? ` data-block-width="${blockWidth}"`
        : "";
      const alignAttr = align ? ` data-align="${align}"` : "";
      return `<div data-chart-id="${chartId}" data-type="chart" class="chart-block"${blockWidthAttr}${alignAttr}></div>`;
    },
  );
}

/**
 * Convert fenced mermaid code blocks to MermaidBlock node HTML elements
 * before tiptap-markdown parses the content.
 *
 * Matches: ```mermaid\n...\n```
 * Outputs: <div data-mermaid-source="..." data-type="mermaid" class="mermaid-block"></div>
 *
 * The source is HTML-escaped and stored as a data attribute.
 */
export function convertMermaidToHtml(markdown: string): string {
  return markdown.replace(
    /```mermaid\n([\s\S]*?)```/g,
    (_match, source: string) => {
      // HTML-escape the source for safe attribute embedding.
      // Newlines must also be escaped — literal newlines inside HTML attributes
      // can cause parsers to split the tag at blank lines.
      const escaped = source.trimEnd()
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "&#10;");
      return `<div data-mermaid-source="${escaped}" data-type="mermaid" class="mermaid-block"></div>`;
    },
  );
}

// ---------------------------------------------------------------------------
// Inline fenced code block → HTML converters
// ---------------------------------------------------------------------------

/**
 * Convert fenced ```chart code blocks to Chart node HTML elements
 * before tiptap-markdown parses the content.
 *
 * Matches: ```chart\n{...json...}\n``` or ```chart {width=N align=X}\n{...json...}\n```
 * Outputs: <div data-chart-json="..." data-type="chart" class="chart-block"></div>
 *
 * The JSON content is HTML-attribute-escaped. Regular code blocks are unchanged.
 */
export function convertInlineChartsToHtml(markdown: string): string {
  return markdown.replace(
    /```chart(?:[ \t]+\{([^}]*)\})?\n([\s\S]*?)```/g,
    (_match, attrs: string | undefined, json: string) => {
      const escaped = json.trimEnd()
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const blockWidth = attrs?.match(/width=(\d+)/)?.[1];
      const align = attrs?.match(/align=(left|center|right)/)?.[1];
      const blockWidthAttr = blockWidth ? ` data-block-width="${blockWidth}"` : "";
      const alignAttr = align ? ` data-align="${align}"` : "";
      return `<div data-chart-json="${escaped}" data-type="chart" class="chart-block"${blockWidthAttr}${alignAttr}></div>`;
    },
  );
}

/**
 * Convert fenced ```excalidraw code blocks to Drawing node HTML elements
 * before tiptap-markdown parses the content.
 *
 * Matches: ```excalidraw\n{...json...}\n``` or ```excalidraw {width=N align=X}\n{...json...}\n```
 * Outputs: <div data-drawing-json="..." data-type="drawing" class="drawing-block"></div>
 *
 * The JSON content is HTML-attribute-escaped. Regular code blocks are unchanged.
 */
export function convertInlineDrawingsToHtml(markdown: string): string {
  return markdown.replace(
    /```excalidraw(?:[ \t]+\{([^}]*)\})?\n([\s\S]*?)```/g,
    (_match, attrs: string | undefined, json: string) => {
      const escaped = json.trimEnd()
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const blockWidth = attrs?.match(/width=(\d+)/)?.[1];
      const align = attrs?.match(/align=(left|center|right)/)?.[1];
      const blockWidthAttr = blockWidth ? ` data-block-width="${blockWidth}"` : "";
      const alignAttr = align ? ` data-align="${align}"` : "";
      return `<div data-drawing-json="${escaped}" data-type="drawing" class="drawing-block"${blockWidthAttr}${alignAttr}></div>`;
    },
  );
}

// ---------------------------------------------------------------------------
// Image path space encoding
// ---------------------------------------------------------------------------

/**
 * Convert data URI images to HTML `<img>` tags before markdown-it parsing.
 * markdown-it rejects bare `data:` destinations because they contain `;`, `,`
 * and other characters it doesn't accept in link destinations. HTML `<img>` tags
 * pass through unchanged (html: true) and Tiptap's Image node parses them.
 *
 * Handles both standard `![alt](data:...)` and escaped `!\[alt\](data:...)` forms
 * (some import tools write escaped brackets). Also handles inline data URIs that
 * aren't on their own line.
 */
export function convertDataUriImagesToHtml(markdown: string): string {
  return markdown.replace(
    /!\\?\[([^\]\\]*?)\\?\]\((data:[^)]+)\)/g,
    (_, alt: string, src: string) => {
      const escapedSrc = src.replace(/"/g, '&quot;');
      const altAttr = alt ? ` alt="${alt.replace(/"/g, '&quot;')}"` : '';
      return `<img src="${escapedSrc}"${altAttr}>`;
    },
  );
}

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
      // Remote URLs and data URIs — already handled by wrapDataUriImages
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
// Table column metadata preprocessing
// ---------------------------------------------------------------------------

/**
 * Regex matching an HTML comment with column metadata inside a table cell.
 * Matches: ` <!-- type:number,currency:USD,summary:sum -->`
 */
const TABLE_METADATA_COMMENT_RE = /\s*<!--\s*((?:\w+:\w+)(?:,\s*\w+:\w+)*)\s*-->/g;

/**
 * Per-column metadata extracted from HTML comments in table header cells.
 */
export interface ColumnMetadata {
  colType?: string;
  colCurrency?: string;
  colAggregation?: string;
}

/**
 * Metadata for all tables in a markdown document.
 * Outer key: table occurrence index (0-based).
 * Inner key: column index (0-based).
 */
export type TableColumnMetadataMap = Map<number, Map<number, ColumnMetadata>>;

/**
 * Parse a `key:value,key:value` metadata string into a ColumnMetadata object.
 */
function parseMetadataString(raw: string): ColumnMetadata {
  const KEY_TO_ATTR: Record<string, keyof ColumnMetadata> = {
    type: "colType",
    currency: "colCurrency",
    summary: "colAggregation",
  };

  const meta: ColumnMetadata = {};
  const pairs = raw.split(",");

  for (const pair of pairs) {
    const colonIdx = pair.indexOf(":");
    if (colonIdx < 0) continue;
    const key = pair.slice(0, colonIdx).trim();
    const value = pair.slice(colonIdx + 1).trim();
    const attrName = KEY_TO_ATTR[key];
    if (attrName && value) {
      meta[attrName] = value;
    }
  }

  return meta;
}

/**
 * Extract column metadata comments from GFM table header rows and strip
 * them from the markdown text.
 *
 * Scans for GFM table patterns (header row followed by `| --- | --- |`
 * separator), extracts `<!-- key:value -->` comments from each header cell,
 * and returns both the cleaned markdown and a metadata map.
 */
export function extractTableColumnMetadata(markdown: string): {
  cleaned: string;
  metadata: TableColumnMetadataMap;
} {
  const metadata: TableColumnMetadataMap = new Map();
  const lines = markdown.split("\n");
  let tableIdx = 0;

  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    // Check if this looks like a table header row: starts and ends with |
    // and the next line is a separator row (| --- | --- |)
    if (
      !line.trim().startsWith("|") ||
      !line.trim().endsWith("|") ||
      !nextLine.trim().startsWith("|") ||
      !/^\|[\s:]*-{3,}[\s:]*(\|[\s:]*-{3,}[\s:]*)*\|$/.test(nextLine.trim())
    ) {
      continue;
    }

    // This is a table header row. Check if any cells have metadata comments.
    if (!line.includes("<!--")) {
      tableIdx++;
      continue;
    }

    // Split header cells (remove leading/trailing |)
    const cellTexts = line
      .trim()
      .slice(1, -1)
      .split("|");

    const columnMetadata = new Map<number, ColumnMetadata>();
    const cleanedCells: string[] = [];
    let hasMetadata = false;

    for (let colIdx = 0; colIdx < cellTexts.length; colIdx++) {
      const cellText = cellTexts[colIdx];
      TABLE_METADATA_COMMENT_RE.lastIndex = 0;
      const match = TABLE_METADATA_COMMENT_RE.exec(cellText);

      if (match) {
        const meta = parseMetadataString(match[1]);
        if (Object.keys(meta).length > 0) {
          columnMetadata.set(colIdx, meta);
          hasMetadata = true;
        }
        // Strip the comment from the cell text
        cleanedCells.push(cellText.replace(TABLE_METADATA_COMMENT_RE, ""));
      } else {
        cleanedCells.push(cellText);
      }
    }

    if (hasMetadata) {
      metadata.set(tableIdx, columnMetadata);
      // Reconstruct the header line without metadata comments
      lines[i] = `|${cleanedCells.join("|")}|`;
    }

    tableIdx++;
  }

  return {
    cleaned: lines.join("\n"),
    metadata,
  };
}

/**
 * Apply extracted column metadata to TableHeader nodes in the ProseMirror
 * document. Dispatches a single transaction with `addToHistory: false`.
 */
export function applyTableColumnMetadata(
  editor: Editor,
  metadata: TableColumnMetadataMap,
): void {
  if (metadata.size === 0) return;

  editor.chain().command(({ tr, state }) => {
    tr.setMeta("addToHistory", false);
    let tableIdx = 0;
    let modified = false;

    state.doc.descendants((node, pos) => {
      if (node.type.name !== "table") return;

      const colMeta = metadata.get(tableIdx);
      tableIdx++;

      if (!colMeta) return;

      // Walk the first row to find header cells
      const firstRow = node.firstChild;
      if (!firstRow) return;

      let colIdx = 0;
      firstRow.forEach((_cell, cellOffset) => {
        const meta = colMeta.get(colIdx);
        colIdx++;
        if (!meta) return;

        // pos is the table position, +1 for inside table, +cellOffset+1 for inside row
        const cellPos = pos + 1 + cellOffset + 1;

        if (meta.colType) {
          tr.setNodeAttribute(cellPos, "colType", meta.colType);
          modified = true;
        }
        if (meta.colCurrency) {
          tr.setNodeAttribute(cellPos, "colCurrency", meta.colCurrency);
          modified = true;
        }
        if (meta.colAggregation) {
          tr.setNodeAttribute(cellPos, "colAggregation", meta.colAggregation);
          modified = true;
        }
      });
    });

    return modified;
  }).run();
}

// ---------------------------------------------------------------------------
// Table of Contents preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert `<!-- toc -->` HTML comments to a `<div>` element that
 * tiptap-markdown can parse and preserve as a TOC node in ProseMirror.
 *
 * On serialization, `getMarkdownFromEditor` converts these back to the
 * comment form via `restoreTocComments`.
 */
export function convertTocToHtml(markdown: string): string {
  return markdown.replace(
    /^<!-- toc -->$/gm,
    '<div data-toc="true" class="toc-block"></div>',
  );
}

/**
 * Restore `<!-- toc -->` comments from the serialized HTML div form.
 * Called during `getMarkdownFromEditor` to produce clean markdown.
 */
export function restoreTocComments(markdown: string): string {
  return markdown.replace(
    /^<div data-toc[^>]*><\/div>$/gm,
    '<!-- toc -->',
  );
}

// ---------------------------------------------------------------------------
// Node ID preprocessing (UniqueID extension)
// ---------------------------------------------------------------------------

/**
 * Regex matching `<!-- id:uuid -->` HTML comments on their own line,
 * immediately before a block element. These persist node IDs through
 * markdown round-trips.
 *
 * The UUID format: 8-4-4-4-12 hex digits (standard crypto.randomUUID).
 */
const NODE_ID_COMMENT_RE = /^<!-- id:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) -->$/;

/**
 * Strip `<!-- id:uuid -->` HTML comments from markdown and collect them
 * as an ordered list. The IDs are applied to top-level ProseMirror block
 * nodes in order after parsing via `applyNodeIdsToEditor`.
 *
 * The map keys are 0-based indices corresponding to the sequential
 * position of each ID comment relative to the blocks they precede.
 * ID comments must appear on the line immediately before their block.
 */
export function stripNodeIdComments(markdown: string): {
  cleaned: string;
  nodeIds: Map<number, string>;
} {
  const lines = markdown.split('\n');
  const result: string[] = [];
  // Collect IDs in order: orderedIds[i] = the UUID for the i-th block that had an ID
  const orderedIds: Array<{ id: string; blockNumber: number }> = [];

  // First pass: strip ID comments and figure out which block they precede
  let pendingId: string | null = null;
  let blockCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(NODE_ID_COMMENT_RE);
    if (match) {
      pendingId = match[1];
      // Don't add to result — strip this line
      continue;
    }

    result.push(lines[i]);

    // Detect block starts in the cleaned output for numbering
    if (lines[i].trim() !== '') {
      const cleanedIdx = result.length - 1;
      const prevCleanedLine = cleanedIdx > 0 ? result[cleanedIdx - 1] : '';
      const isBlockStart = cleanedIdx === 0 || prevCleanedLine.trim() === '';

      if (isBlockStart) {
        if (pendingId) {
          orderedIds.push({ id: pendingId, blockNumber: blockCount });
          pendingId = null;
        }
        blockCount++;
      }
    }
  }

  const nodeIds = new Map<number, string>();
  for (const entry of orderedIds) {
    nodeIds.set(entry.blockNumber, entry.id);
  }

  return { cleaned: result.join('\n'), nodeIds };
}

/**
 * Apply node IDs extracted from HTML comments to top-level block nodes
 * in the ProseMirror document. Dispatches a single transaction with
 * `addToHistory: false`.
 */
export function applyNodeIdsToEditor(
  editor: Editor,
  nodeIds: Map<number, string>,
): void {
  if (nodeIds.size === 0) return;

  const { state } = editor;
  const tr = state.tr.setMeta('addToHistory', false);
  let blockIndex = 0;
  let modified = false;

  // Walk top-level children of the document (0-based index)
  state.doc.forEach((node, offset) => {
    const id = nodeIds.get(blockIndex);
    if (id && node.type.name !== 'doc' && node.type.name !== 'text') {
      tr.setNodeAttribute(offset, 'id', id);
      modified = true;
    }
    blockIndex++;
  });

  if (modified) {
    editor.view.dispatch(tr);
  }
}

/**
 * Inject `<!-- id:uuid -->` HTML comments into serialized markdown before
 * each top-level block that has a node ID. Called during `getMarkdownFromEditor`.
 */
export function injectNodeIdComments(markdown: string, editor: Editor): string {
  // Collect IDs from top-level block nodes in document order
  const blockIds: Array<{ id: string }> = [];
  editor.state.doc.forEach((node) => {
    const id: unknown = node.attrs.id;
    blockIds.push({ id: typeof id === 'string' && id ? id : '' });
  });

  // If no blocks have IDs, return unchanged
  if (blockIds.every((b) => !b.id)) return markdown;

  // Split markdown into blocks (separated by blank lines) and inject comments
  const lines = markdown.split('\n');
  const result: string[] = [];
  let blockIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect block start: non-empty line after a blank line or at start
    if (line.trim() !== '') {
      const prevLine = i > 0 ? lines[i - 1] : '';
      const isBlockStart = i === 0 || prevLine.trim() === '';

      if (isBlockStart && blockIndex < blockIds.length) {
        const id = blockIds[blockIndex].id;
        if (id) {
          result.push(`<!-- id:${id} -->`);
        }
        blockIndex++;
      }
    }

    result.push(line);
  }

  return result.join('\n');
}

// ---------------------------------------------------------------------------
// Page break preprocessing
// ---------------------------------------------------------------------------

/**
 * Convert `<!-- pagebreak -->` HTML comments to a `<div>` element that
 * tiptap-markdown can parse and preserve as an HTML block in ProseMirror.
 *
 * On serialization, `getMarkdownFromEditor` converts these back to the
 * comment form via `restorePageBreaks`.
 */
export function convertPageBreaksToHtml(markdown: string): string {
  return markdown.replace(
    /^<!-- pagebreak -->$/gm,
    '<div data-page-break="true" style="page-break-before: always"></div>',
  );
}

/**
 * Restore `<!-- pagebreak -->` comments from the serialized HTML div form.
 * Called during `getMarkdownFromEditor` to produce clean markdown.
 */
export function restorePageBreaks(markdown: string): string {
  return markdown.replace(
    /^<div data-page-break[^>]*><\/div>$/gm,
    '<!-- pagebreak -->',
  );
}

// ---------------------------------------------------------------------------
// Editor ↔ Markdown helpers
// ---------------------------------------------------------------------------

export function getMarkdownFromEditor(editor: Editor): string {
  let markdown = "";

  // Try to use the Markdown extension's getMarkdown method
  try {
    const mdStorage = getEditorStorage<EditorStorageMarkdown>(editor, "markdown");
    if (typeof mdStorage?.getMarkdown === "function") {
      markdown = decodeImagePathSpaces(mdStorage.getMarkdown());
    }
  } catch (error) {
    console.warn("Failed to get markdown from storage:", error);
  }

  // Last resort
  if (!markdown) {
    return editor.getText();
  }

  // Strip ghost empty task items and fix corrupted bracket escaping
  markdown = stripGhostTaskItems(markdown);

  // Restore page break comments from HTML div form
  markdown = restorePageBreaks(markdown);

  // Restore TOC comments from HTML div form
  markdown = restoreTocComments(markdown);

  // Node ID injection disabled — too noisy in source mode (every paragraph gets
  // <!-- id:uuid -->). UniqueID extension still active for in-session comment
  // anchoring but IDs are not persisted to markdown.
  // markdown = injectNodeIdComments(markdown, editor);

  // Inject {emoji} prefixes from the current ProseMirror document annotations
  return injectAnnotationsIntoMarkdown(markdown, editor);
}


export function setMarkdownInEditor(editor: Editor, markdown: string): void {
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(markdown);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  const encoded = convertDataUriImagesToHtml(encodeImagePathSpaces(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertTocToHtml(convertPageBreaksToHtml(convertCalloutsToHtml(convertMermaidToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(noMeta)))))))))))));
  setContentWithoutHistory(editor, encoded);

  if (metadata.size > 0) {
    applyTableColumnMetadata(editor, metadata);
  }
  if (nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, nodeIds);
  }
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
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(cleaned);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  const encoded = convertDataUriImagesToHtml(encodeImagePathSpaces(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertTocToHtml(convertPageBreaksToHtml(convertCalloutsToHtml(convertMermaidToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(noMeta)))))))))))));

  // [perf:setContent] instrumentation — measures main-thread cost of the
  // DOM teardown + rebuild. The "old" doc size is what we're throwing away;
  // the "new" doc size is what we're building. Both contribute to the cost.
  const oldDocSize = editor.state.doc.nodeSize;
  const t0 = performance.now();
  editor.chain().setMeta("addToHistory", false).setContent(encoded).run();
  const setContentMs = performance.now() - t0;
  const newDocSize = editor.state.doc.nodeSize;

  // Clear undo/redo history — the loaded content is a fresh baseline.
  // Without this, stale history entries from the previous document cause
  // silent no-op undos and unexpected cursor jumps after tab switches.
  const t1 = performance.now();
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);
  const freshStateMs = performance.now() - t1;

  const t2 = performance.now();
  if (metadata.size > 0) {
    applyTableColumnMetadata(editor, metadata);
  }
  if (nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, nodeIds);
  }
  const sideMapsMs = performance.now() - t2;

  console.log("[perf:setContent]", {
    path: "raw-markdown",
    oldDocSize,
    newDocSize,
    setContentMs: +setContentMs.toFixed(1),
    freshStateMs: +freshStateMs.toFixed(1),
    sideMapsMs: +sideMapsMs.toFixed(1),
    totalMs: +(setContentMs + freshStateMs + sideMapsMs).toFixed(1),
  });

  if (annotations.size > 0) {
    requestAnimationFrame(() => {
      applyAnnotationsToEditor(editor, annotations);
    });
  }
}

// ---------------------------------------------------------------------------
// Worker hydration path (Phase 2 — Layer 2)
// ---------------------------------------------------------------------------

/**
 * Companion to `loadRawMarkdownIntoEditor` for the Phase 2 worker hydration
 * path. The worker has already done the expensive markdown→HTML→ProseMirror
 * parse off-thread; the main thread just feeds the JSON to setContent and
 * applies the side-channel maps (annotations, nodeIds, table metadata) the
 * same way the legacy synchronous path does.
 *
 * `setContent(json, false)` is dramatically cheaper than `setContent(html)`
 * because the heavy schema-walk parse already happened in the worker.
 * This is the critical hot path that takes the 4.5–5.1s `animation-frame-fired`
 * block from "freezes the entire app" to "completes in milliseconds."
 */
export function loadParsedJsonIntoEditor(
  editor: Editor,
  /** ProseMirror JSON from the worker's `node.toJSON()`. */
  doc: unknown,
  side: {
    annotations: Map<number, string>;
    nodeIds: Map<number, string>;
    tableMetadata: TableColumnMetadataMap;
  },
): void {
  // [perf:setContent] instrumentation — see `loadRawMarkdownIntoEditor`
  // for rationale. This is the worker-hydration path; setContent here
  // accepts pre-parsed ProseMirror JSON which is dramatically cheaper
  // than parsing markdown, but the DOM materialize cost is the same.
  const oldDocSize = editor.state.doc.nodeSize;
  const t0 = performance.now();
  editor.chain().setMeta("addToHistory", false).setContent(doc as never).run();
  const setContentMs = performance.now() - t0;
  const newDocSize = editor.state.doc.nodeSize;

  // Same fresh-state pattern as `loadRawMarkdownIntoEditor` — clears undo
  // history so stale entries from the previous document don't corrupt the
  // user's first undo after open.
  const t1 = performance.now();
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);
  const freshStateMs = performance.now() - t1;

  const t2 = performance.now();
  if (side.tableMetadata.size > 0) {
    applyTableColumnMetadata(editor, side.tableMetadata);
  }
  if (side.nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, side.nodeIds);
  }
  const sideMapsMs = performance.now() - t2;

  console.log("[perf:setContent]", {
    path: "parsed-json",
    oldDocSize,
    newDocSize,
    setContentMs: +setContentMs.toFixed(1),
    freshStateMs: +freshStateMs.toFixed(1),
    sideMapsMs: +sideMapsMs.toFixed(1),
    totalMs: +(setContentMs + freshStateMs + sideMapsMs).toFixed(1),
  });

  if (side.annotations.size > 0) {
    requestAnimationFrame(() => {
      applyAnnotationsToEditor(editor, side.annotations);
    });
  }
}

/**
 * Default chunk size for streaming hydration. ~1000 top-level nodes per
 * chunk lands at roughly 30–60 ms of synchronous JS per chunk in dev mode
 * — short enough that yielding between chunks keeps clicks responsive,
 * large enough that the per-chunk transaction overhead doesn't dominate.
 *
 * Tuneable: smaller = more responsive, longer total time. Larger = closer
 * to single-shot setContent, less interruptible.
 */
const HYDRATE_CHUNK_SIZE = 1000;

/**
 * Streaming version of `loadParsedJsonIntoEditor` — inserts the parsed
 * doc in chunks with `setTimeout(0)` yields between chunks, gated on an
 * abort signal. Designed so that a click on a different tab during
 * hydration cleanly interrupts the in-flight load (next chunk's abort
 * check bails) instead of running the full ~4 s synchronous setContent
 * that ProseMirror does in one shot.
 *
 * Returns a structured result so the caller can log timings and decide
 * what to do on abort. The editor is left in a partially-hydrated state
 * on abort — the next call to `streamingHydrate` will replace its
 * content via the leading `setContent({content: []})` reset.
 *
 * The side-channel maps (table metadata, nodeIds, annotations) are
 * applied at the END after streaming completes. Applying them per-chunk
 * would double the transaction count.
 */
export async function streamingHydrate(
  editor: Editor,
  /** ProseMirror JSON from the worker's `node.toJSON()`. */
  doc: unknown,
  side: {
    annotations: Map<number, string>;
    nodeIds: Map<number, string>;
    tableMetadata: TableColumnMetadataMap;
  },
  signal: AbortSignal,
): Promise<{
  aborted: boolean;
  chunkCount: number;
  topLevelNodes: number;
  newDocSize: number;
  oldDocSize: number;
  ms: number;
}> {
  const t0 = performance.now();
  const oldDocSize = editor.state.doc.nodeSize;

  const docContent = (doc as { content?: unknown[] } | null)?.content;

  // Empty / malformed doc — fast path. Just clear the editor.
  if (!Array.isArray(docContent) || docContent.length === 0) {
    if (signal.aborted) {
      return { aborted: true, chunkCount: 0, topLevelNodes: 0, newDocSize: 0, oldDocSize, ms: performance.now() - t0 };
    }
    editor.chain().setMeta("addToHistory", false).setContent({ type: "doc", content: [] }).run();
    return {
      aborted: false,
      chunkCount: 0,
      topLevelNodes: 0,
      newDocSize: editor.state.doc.nodeSize,
      oldDocSize,
      ms: performance.now() - t0,
    };
  }

  if (signal.aborted) {
    return { aborted: true, chunkCount: 0, topLevelNodes: docContent.length, newDocSize: oldDocSize, oldDocSize, ms: performance.now() - t0 };
  }

  // Stream content in chunks. The FIRST chunk uses `setContent` so it
  // replaces existing content in one transaction (matching the old
  // `loadParsedJsonIntoEditor` behaviour for single-chunk small docs).
  // Subsequent chunks use `insertContent` to append. Yielding via rAF
  // between chunks so click events can fire and abort the loop —
  // single-chunk fast path skips the yield, no overhead.
  let chunkCount = 0;
  for (let i = 0; i < docContent.length; i += HYDRATE_CHUNK_SIZE) {
    if (signal.aborted) {
      return { aborted: true, chunkCount, topLevelNodes: docContent.length, newDocSize: editor.state.doc.nodeSize, oldDocSize, ms: performance.now() - t0 };
    }

    const chunk = docContent.slice(i, i + HYDRATE_CHUNK_SIZE);
    const isFirstChunk = i === 0;
    if (isFirstChunk) {
      // Single-shot replacement — same as legacy `loadParsedJsonIntoEditor`
      // for small docs that fit in one chunk. Avoids the double-transaction
      // (clear + insert) that detaches DOM Playwright is mid-clicking.
      editor.chain().setMeta("addToHistory", false).setContent({ type: "doc", content: chunk } as never).run();
    } else {
      editor.chain().setMeta("addToHistory", false).insertContent(chunk as never).run();
    }
    chunkCount++;

    // Yield between chunks via `requestAnimationFrame`. Why not
    // `setTimeout(0)`? setTimeout fires the next chunk before the
    // browser has a chance to paint or run hover/cursor hit-tests, so
    // sidebar items don't show the pointer cursor during streaming.
    // rAF guarantees one paint frame between chunks (~16 ms on 60 Hz),
    // which is enough for cursor + hover styles + click events to fire
    // cleanly. Costs ~16 ms × N chunks of total time vs 1–4 ms × N for
    // setTimeout — worth it for the responsiveness win. Skip the yield
    // on the last chunk — no point waiting for nothing.
    if (i + HYDRATE_CHUNK_SIZE < docContent.length) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
  }

  if (signal.aborted) {
    return { aborted: true, chunkCount, topLevelNodes: docContent.length, newDocSize: editor.state.doc.nodeSize, oldDocSize, ms: performance.now() - t0 };
  }

  // Same fresh-state pattern as `loadParsedJsonIntoEditor` — clears undo
  // history so stale entries from the previous document don't corrupt
  // the user's first undo after open.
  const freshState = EditorState.create({
    doc: editor.state.doc,
    plugins: editor.state.plugins,
  });
  editor.view.updateState(freshState);

  // Side-channel maps applied AFTER streaming. Each is a single
  // transaction; doing them per-chunk would multiply overhead.
  if (side.tableMetadata.size > 0) {
    applyTableColumnMetadata(editor, side.tableMetadata);
  }
  if (side.nodeIds.size > 0) {
    applyNodeIdsToEditor(editor, side.nodeIds);
  }
  if (side.annotations.size > 0) {
    requestAnimationFrame(() => {
      applyAnnotationsToEditor(editor, side.annotations);
    });
  }

  return {
    aborted: false,
    chunkCount,
    topLevelNodes: docContent.length,
    newDocSize: editor.state.doc.nodeSize,
    oldDocSize,
    ms: performance.now() - t0,
  };
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
  tableMetadata: TableColumnMetadataMap;
  nodeIds: Map<number, string>;
} {
  const { cleaned, annotations } = stripAnnotationsFromMarkdown(rawMarkdown);
  const { cleaned: noIds, nodeIds } = stripNodeIdComments(cleaned);
  const { cleaned: noMeta, metadata } = extractTableColumnMetadata(noIds);
  return {
    content: convertDataUriImagesToHtml(encodeImagePathSpaces(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertLinkPreviewsToHtml(convertTocToHtml(convertPageBreaksToHtml(convertCalloutsToHtml(convertMermaidToHtml(normalizeEmptyTaskItems(stripGhostTaskItems(noMeta))))))))))))),
    annotations,
    tableMetadata: metadata,
    nodeIds,
  };
}
