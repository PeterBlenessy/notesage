/**
 * Worker-safe Tiptap extension subset for the markdown-parse Web Worker.
 * See `docs/prds/2026-05-03-large-file-instant-load.md` § "Layer 2" and
 * Phase 2 task #9.
 *
 * The full editor extension list (`src/hooks/useEditor.ts`) imports React,
 * Excalidraw, mermaid, recharts, Tauri IPC, Zustand stores with localStorage,
 * and other DOM/browser-tied modules at module load. None of those are
 * available in a Web Worker. This file provides a minimal extension array
 * that:
 *
 *   1. Imports ONLY pure-JS modules at top-level (no React, no DOM-touching
 *      Zustand, no Tauri IPC).
 *   2. Defines schema-shape-equivalent shims for the heavy custom nodes
 *      (Drawing, Chart, MermaidBlock, LinkPreview, TableOfContents).
 *      Shims have the SAME node name + parseHTML rules + attribute schema
 *      as the originals, but skip `addNodeView`, `addCommands`, and any
 *      DOM-driven plugins. The parsed JSON output is byte-identical to
 *      what the main-thread editor would produce — verified by Phase 2
 *      task #19's parity test.
 *
 * Constraint: every node name + every attribute name MUST match the
 * main-thread extension exactly. The main thread feeds the worker's
 * JSON output to `editor.commands.setContent(json)`, which validates
 * against the editor's own schema. A name mismatch silently strips the
 * node; an attribute mismatch silently strips the attribute. Both are
 * round-trip data loss.
 *
 * **Schema fingerprint discipline (Phase 3b — viewport cache).** The
 * `CACHE_SCHEMA_VERSION` constant below is part of the IndexedDB viewport
 * cache key. If you add, remove, rename, or re-attribute any extension in
 * this file in a way that affects rendered HTML, **bump `CACHE_SCHEMA_VERSION`**
 * so existing on-disk viewport cache entries auto-invalidate. The regression
 * watch in `__tests__/worker-extensions.test.ts` snapshots the constant +
 * sorted name list and fails on any drift, so you can't forget.
 */

import StarterKit from "@tiptap/starter-kit";
import { Node, Mark, mergeAttributes } from "@tiptap/core";
import UniqueID from "@tiptap/extension-unique-id";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";

const lowlight = createLowlight(common);

/**
 * Schema fingerprint version for the Phase 3b IndexedDB viewport cache.
 * Bump this whenever a worker extension's name, attribute schema, or
 * parseHTML rule changes in a way that affects rendered HTML output.
 *
 * The cache key for each entry includes the SHA-256 of
 * `${CACHE_SCHEMA_VERSION}|${sorted-extension-names}` — bumping the version
 * forces every existing entry to invalidate on next read. The regression
 * watch in `__tests__/worker-extensions.test.ts` snapshots the combined
 * fingerprint and fails on any drift.
 */
export const CACHE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Shims for heavy custom nodes
// ---------------------------------------------------------------------------

/**
 * Shim for `src/components/editor/extensions/drawing.ts`. The original imports
 * ReactNodeViewRenderer + DrawingPreview React component. Here we emit only
 * the schema spec — same node name, same 4 attributes, same 2 parseHTML
 * patterns. Round-trip safe.
 */
const Drawing = Node.create({
  name: "drawing",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      drawingId: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-drawing-id") || null,
      },
      width: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const w = el.getAttribute("data-width");
          return w ? Number(w) : null;
        },
      },
      height: {
        default: 600,
        parseHTML: (el: HTMLElement) => {
          const h = el.getAttribute("data-height");
          return h ? Number(h) : 600;
        },
      },
      drawingJson: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-drawing-json") || null,
      },
      // Block-level width/align controls (BlockSizeControls). Must mirror the
      // production extension's schema or the worker silently drops the attrs
      // when parsing — the production-shim divergence cost #173-follow-up the
      // user a full debug cycle.
      blockWidth: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-block-width");
          return v ? Number(v) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.blockWidth == null
            ? {}
            : { "data-block-width": String(attrs.blockWidth) },
      },
      align: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.align == null ? {} : { "data-align": attrs.align as string },
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-drawing-json]" }, { tag: "div[data-drawing-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "drawing-block", "data-type": "drawing" })];
  },
});

/**
 * Shim for `src/components/editor/extensions/chart.ts` — same shape as Drawing.
 * Default height differs (300 vs 600).
 */
const Chart = Node.create({
  name: "chart",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      chartId: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-chart-id") || null,
      },
      width: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const w = el.getAttribute("data-width");
          return w ? Number(w) : null;
        },
      },
      height: {
        default: 300,
        parseHTML: (el: HTMLElement) => {
          const h = el.getAttribute("data-height");
          return h ? Number(h) : 300;
        },
      },
      chartJson: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-chart-json") || null,
      },
      blockWidth: {
        default: null as number | null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute("data-block-width");
          return v ? Number(v) : null;
        },
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.blockWidth == null
            ? {}
            : { "data-block-width": String(attrs.blockWidth) },
      },
      align: {
        default: null as string | null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-align") || null,
        renderHTML: (attrs: Record<string, unknown>) =>
          attrs.align == null ? {} : { "data-align": attrs.align as string },
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-chart-json]" }, { tag: "div[data-chart-id]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "chart-block", "data-type": "chart" })];
  },
});

/**
 * Shim for `src/components/editor/extensions/mermaid.ts` — single source attr.
 */
const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-mermaid-source") || "",
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-mermaid-source]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "mermaid-block", "data-type": "mermaid" })];
  },
});

/**
 * Shim for `src/components/editor/extensions/link-preview.ts` — six metadata
 * attrs (url, title, description, siteName, imageUrl, faviconUrl).
 */
const LinkPreview = Node.create({
  name: "linkPreview",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      url: { default: "" },
      title: { default: null },
      description: { default: null },
      siteName: { default: null },
      imageUrl: { default: null },
      faviconUrl: { default: null },
      blockWidth: { default: null as number | null },
      align: { default: null as string | null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-link-preview]",
        getAttrs: (element: HTMLElement) => {
          const bw = element.getAttribute("data-block-width");
          return {
            url: element.getAttribute("data-link-preview") || "",
            title: element.getAttribute("data-title") || null,
            description: element.getAttribute("data-description") || null,
            siteName: element.getAttribute("data-site-name") || null,
            imageUrl: element.getAttribute("data-image-url") || null,
            faviconUrl: element.getAttribute("data-favicon-url") || null,
            blockWidth: bw ? Number(bw) : null,
            align: element.getAttribute("data-align") || null,
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { class: "link-preview", "data-type": "linkPreview" })];
  },
});

/**
 * Shim for `src/components/editor/extensions/toc.ts` — renders as
 * `<div data-toc>`, parsed back when round-tripped.
 */
const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "div[data-toc]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-toc": "true" })];
  },
});

/**
 * Shim for `src/components/editor/extensions/page-break-node.ts`. Pure schema
 * — original is already worker-safe but kept here for clarity (single source
 * of truth for the worker's extension list).
 */
const PageBreakNode = Node.create({
  name: "pageBreak",
  group: "block",
  atom: true,
  parseHTML() {
    return [{ tag: "div[data-page-break]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-page-break": "true", class: "page-break" })];
  },
});

/**
 * Shim for `src/components/editor/extensions/callout.ts`. Original is
 * worker-safe (no React imports), but the file imports `TextSelection` and
 * defines input rules + commands that we don't need for parsing. Stick to a
 * lean shim so the worker bundle stays small.
 */
const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      type: {
        default: "note" as "note" | "tip" | "warning" | "important",
        parseHTML: (el: HTMLElement) =>
          (el.getAttribute("data-callout-type") as "note" | "tip" | "warning" | "important") || "note",
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-callout-type]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "callout", class: "callout" }),
      0,
    ];
  },
});

/**
 * Shim for `src/components/editor/extensions/themed-highlight.ts`.
 * The themed variant maps semantic color names to CSS classes; for parse-only
 * we just need the mark with a `color` attribute. Hex-attribute legacy
 * compatibility (handled in the real extension) doesn't matter here.
 */
const ThemedHighlight = Highlight.extend({
  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) =>
          el.getAttribute("data-color") || el.style.backgroundColor || null,
      },
    };
  },
});

/**
 * Shim for `src/components/editor/extensions/local-image.ts`. The original
 * imports `resolveImageSrc` for Tauri asset-protocol URL conversion; for
 * parse-only purposes we just need Image with the same configuration.
 */
const LocalImage = Image.configure({ allowBase64: true });

/**
 * Shim for `src/components/editor/extensions/table-header-attrs.ts`. Adds the
 * column-metadata attrs (`colType`, `colCurrency`, `colAggregation`,
 * `colSortDirection`) to the standard TableHeader so they round-trip.
 */
const TableHeaderWithAttrs = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      colType: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-col-type") || null,
      },
      colCurrency: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-col-currency") || null,
      },
      colAggregation: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-col-aggregation") || null,
      },
      colSortDirection: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-col-sort-direction") || null,
      },
    };
  },
});

/**
 * Shim for `src/components/editor/extensions/typography-overrides.ts`.
 * Adds five optional attrs (fontFamily, fontSize, fontWeight, lineHeight,
 * color) to Heading and Paragraph. Original imports fontFamilyCSS from a
 * Zustand store; we don't need it here because we're never serializing
 * inline styles in the worker — the schema just needs to define the
 * attribute shapes so they survive the round-trip.
 */
const OVERRIDE_ATTR_NAMES = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "color"] as const;

function typographyOverrideAttrs(): Record<
  string,
  { default: null; parseHTML: () => null; renderHTML: () => Record<string, never> }
> {
  const defs: Record<
    string,
    { default: null; parseHTML: () => null; renderHTML: () => Record<string, never> }
  > = {};
  for (const name of OVERRIDE_ATTR_NAMES) {
    defs[name] = {
      default: null,
      parseHTML: () => null,
      renderHTML: () => ({}),
    };
  }
  return defs;
}

// We extend StarterKit's bundled Heading + Paragraph by configuring the
// StarterKit subset and adding our own. To keep the schema names matching
// (`heading`, `paragraph`), we DISABLE StarterKit's heading + paragraph and
// supply our own extended versions.
import Heading from "@tiptap/extension-heading";
import Paragraph from "@tiptap/extension-paragraph";

const HeadingWithOverrides = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), ...typographyOverrideAttrs() };
  },
});

const ParagraphWithOverrides = Paragraph.extend({
  addAttributes() {
    return { ...this.parent?.(), ...typographyOverrideAttrs() };
  },
});

// ---------------------------------------------------------------------------
// CommentMark — schema mark, no plugin in worker
// ---------------------------------------------------------------------------

/**
 * The real `CommentMark` (`src/components/editor/extensions/comment-mark.ts`)
 * is a decoration plugin that renders comment-anchor highlights. It does NOT
 * define a schema mark — comment positions are stored externally in the
 * comment-store, applied via `applyAnnotationsToEditor` post-setContent.
 *
 * That means the worker doesn't need a CommentMark equivalent: the parsed
 * JSON has no comment marks; the main thread applies them after setContent.
 */
void Mark; // referenced to satisfy unused-import lint; kept for future schema marks

// ---------------------------------------------------------------------------
// Worker extension list
// ---------------------------------------------------------------------------

/**
 * The full set of extensions used to construct the worker-side schema. Order
 * matters for some Tiptap behaviours (StarterKit's defaults override later
 * additions); mirror useEditor.ts's order where it matters.
 */
export const workerExtensions = [
  StarterKit.configure({
    codeBlock: false, // replaced by CodeBlockLowlight
    heading: false, // replaced by HeadingWithOverrides
    paragraph: false, // replaced by ParagraphWithOverrides
    link: { openOnClick: false },
  }),
  HeadingWithOverrides.configure({ levels: [1, 2, 3, 4, 5, 6] }),
  ParagraphWithOverrides,
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  TextStyle,
  Color,
  ThemedHighlight.configure({ multicolor: true }),
  Subscript,
  Superscript,
  LocalImage,
  CodeBlockLowlight.configure({ lowlight }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeaderWithAttrs,
  TableCell,
  TaskList,
  TaskItem.configure({ nested: true }),
  UniqueID.configure({
    types: [
      "paragraph",
      "heading",
      "listItem",
      "taskItem",
      "codeBlock",
      "blockquote",
      "table",
      "image",
      "drawing",
      "chart",
      "callout",
      "linkPreview",
      "mermaidBlock",
      "horizontalRule",
    ],
    generateID: () => crypto.randomUUID(),
  }),
  // Custom schema-defining nodes (shims for parse-only use)
  Callout,
  Drawing,
  Chart,
  MermaidBlock,
  LinkPreview,
  TableOfContents,
  PageBreakNode,
];
