/**
 * Markdown round-trip tests.
 *
 * For each fixture file in tests/fixtures/:
 *   1. Parse markdown into a ProseMirror document (via tiptap-markdown)
 *   2. Serialize back to markdown
 *   3. Compare with whitespace normalization
 *
 * This is the #1 spec requirement: "must pass before any PR".
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeaderWithAttrs } from "@/components/editor/extensions/table-header-attrs";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";
import { Callout } from "@/components/editor/extensions/callout";
import { Drawing } from "@/components/editor/extensions/drawing";
import { Chart } from "@/components/editor/extensions/chart";
import { LinkPreview } from "@/components/editor/extensions/link-preview";
import { MermaidBlock } from "@/components/editor/extensions/mermaid";
import { PageBreakNode } from "@/components/editor/extensions/page-break-node";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import markdownitSub from "markdown-it-sub";
import markdownitSup from "markdown-it-sup";
import { convertCalloutsToHtml, convertDrawingsToHtml, convertChartsToHtml, convertLinkPreviewsToHtml, convertMermaidToHtml, convertPageBreaksToHtml, convertInlineChartsToHtml, convertInlineDrawingsToHtml, convertDataUriImagesToHtml, restorePageBreaks } from "@/lib/markdown";
import { serializeTable } from "@/components/editor/extensions/table-markdown";
import { workerExtensions } from "@/workers/worker-extensions";

// ---------------------------------------------------------------------------
// jsdom bootstrap — ProseMirror needs a global DOM
// ---------------------------------------------------------------------------

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"editor\"></div></body></html>");
  // Expose globals that ProseMirror / Tiptap expect
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  // DOMParser is needed by tiptap-markdown for parsing HTML
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
  globalThis.getComputedStyle = dom.window.getComputedStyle as unknown as typeof getComputedStyle;
});

// ---------------------------------------------------------------------------
// Whitespace normalization
// ---------------------------------------------------------------------------

/**
 * Normalize whitespace for comparison:
 * - Trim trailing spaces on each line
 * - Collapse multiple consecutive blank lines into a single blank line
 * - Trim leading/trailing newlines from the whole string
 */
function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------

const lowlight = createLowlight(common);

/**
 * Create a headless Tiptap editor with the same content extensions as
 * the real editor (useEditor.ts), minus decoration-only plugins that
 * don't affect markdown serialization.
 */
function createTestEditor(content: string): Editor {
  const el = document.createElement("div");

  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: {
          class: "rounded-lg max-w-full",
        },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Table.extend({
        addStorage() {
          return {
            ...this.parent?.(),
            markdown: {
              serialize: serializeTable,
              parse: {},
            },
          };
        },
      }).configure({
        resizable: false,
      }),
      TableRow,
      TableCell,
      TableHeaderWithAttrs,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
        linkify: false,
      }),
      Callout,
      Drawing,
      Chart,
      LinkPreview,
      MermaidBlock,
      PageBreakNode,
      Subscript.extend({
        addStorage() {
          return {
            ...this.parent?.(),
            markdown: {
              serialize: { open: "~", close: "~", expelEnclosingWhitespace: true },
              parse: {
                setup(md: { use: (plugin: unknown) => void }) {
                  md.use(markdownitSub);
                },
              },
            },
          };
        },
      }),
      Superscript.extend({
        addStorage() {
          return {
            ...this.parent?.(),
            markdown: {
              serialize: { open: "^", close: "^", expelEnclosingWhitespace: true },
              parse: {
                setup(md: { use: (plugin: unknown) => void }) {
                  md.use(markdownitSup);
                },
              },
            },
          };
        },
      }),
    ],
    content: convertDataUriImagesToHtml(convertInlineChartsToHtml(convertInlineDrawingsToHtml(convertPageBreaksToHtml(convertLinkPreviewsToHtml(convertChartsToHtml(convertDrawingsToHtml(convertCalloutsToHtml(convertMermaidToHtml(content))))))))),
    editable: false,
  });
}

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------

const fixturesDir = join(__dirname, "../../../tests/fixtures");
const fixtureFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Get the serialized markdown from a tiptap editor instance.
 */
function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let md: string = (editor.storage as any).markdown.getMarkdown();
  // Restore page break comments from HTML div form (mirrors getMarkdownFromEditor)
  md = restorePageBreaks(md);
  return md;
}

describe("Markdown round-trip", () => {
  it("has at least 10 fixture files", () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of fixtureFiles) {
    it(`round-trips ${file}`, () => {
      const inputMd = readFileSync(join(fixturesDir, file), "utf-8");

      // First pass: parse → serialize
      const editor1 = createTestEditor(inputMd);
      const pass1 = getMarkdown(editor1);
      editor1.destroy();

      // Second pass: parse the output → serialize again (stability check)
      const editor2 = createTestEditor(pass1);
      const pass2 = getMarkdown(editor2);
      editor2.destroy();

      const normalized1 = normalizeWhitespace(pass1);
      const normalized2 = normalizeWhitespace(pass2);

      // The serialized form must be stable (idempotent)
      expect(normalized2).toBe(normalized1);

      // The first pass should match the input (with whitespace normalization)
      // This ensures fixtures are written in the canonical format
      const normalizedInput = normalizeWhitespace(inputMd);
      expect(normalized1).toBe(normalizedInput);
    });
  }
});

// ---------------------------------------------------------------------------
// Drift guard: the round-trip editor's extension list is hand-maintained here
// (it can't just import `workerExtensions` — that array omits the `Markdown`
// extension and the per-node serialize-storage overrides this test needs). So
// this guard catches the failure mode the 2026-07-08 test-coverage audit found:
// a custom NODE added to production `workerExtensions` (e.g. MermaidBlock, which
// was silently missing) that never gets a round-trip fixture. If this fails,
// either add the node + a fixture to the round-trip editor above, or — if the
// node genuinely isn't markdown-round-tripped as a persisted node (like the TOC
// node, which is materialized from HTML comments) — add it to the allowlist
// below with a reason.
// ---------------------------------------------------------------------------

describe("Round-trip editor covers every production custom node", () => {
  // Production custom nodes that are intentionally NOT serialized as a persisted
  // node through this round-trip editor. Each needs a justification.
  const NOT_ROUNDTRIPPED_AS_NODE = new Set<string>([
    // The table-of-contents is stored as an HTML-comment marker in markdown and
    // rematerialized on load (convertTocToHtml / restoreTocComments), not as a
    // serialized node — so it has no place in the node round-trip editor.
    "tableOfContents",
  ]);

  it("includes every custom node from workerExtensions (or allowlists it)", () => {
    const editor = createTestEditor("");
    const schemaNodes = new Set(Object.keys(editor.schema.nodes));
    editor.destroy();

    // Custom node-typed extensions declared for the production worker schema.
    const productionNodeNames = workerExtensions
      .filter((ext) => (ext as { type?: string }).type === "node")
      .map((ext) => (ext as { name: string }).name);

    const missing = productionNodeNames.filter(
      (name) => !schemaNodes.has(name) && !NOT_ROUNDTRIPPED_AS_NODE.has(name),
    );

    expect(
      missing,
      `Custom production node(s) not represented in the markdown round-trip gate: ${missing.join(
        ", ",
      )}. Add the extension + a fixture above, or allowlist with a reason.`,
    ).toEqual([]);
  });
});
