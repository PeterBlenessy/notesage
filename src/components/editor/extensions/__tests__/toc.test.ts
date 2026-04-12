/**
 * Tests for Table of Contents extension.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { TableOfContents, scanHeadings } from "../toc";
import { convertTocToHtml, restoreTocComments } from "@/lib/markdown";

// ---------------------------------------------------------------------------
// jsdom bootstrap
// ---------------------------------------------------------------------------

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="editor"></div></body></html>'
  );
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.DOMParser =
    dom.window.DOMParser as unknown as typeof DOMParser;
  globalThis.getComputedStyle =
    dom.window.getComputedStyle as unknown as typeof getComputedStyle;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestEditor(content: string): Editor {
  const el = document.createElement("div");
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Markdown.configure({ html: true, linkify: false }),
      TableOfContents,
    ],
    content: convertTocToHtml(content),
    editable: false,
  });
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const md: string = (editor.storage as Record<string, any>).markdown.getMarkdown();
  return restoreTocComments(md);
}

// ---------------------------------------------------------------------------
// Node extension tests
// ---------------------------------------------------------------------------

describe("TableOfContents extension", () => {
  it("registers the tableOfContents node type in the schema", () => {
    const editor = createTestEditor("<p>Hello</p>");
    expect(editor.schema.nodes.tableOfContents).toBeDefined();
    editor.destroy();
  });

  it("node spec is atom (not editable)", () => {
    const editor = createTestEditor("<p>Hello</p>");
    expect(editor.schema.nodes.tableOfContents.spec.atom).toBe(true);
    editor.destroy();
  });

  it("node spec belongs to block group", () => {
    const editor = createTestEditor("<p>Hello</p>");
    expect(editor.schema.nodes.tableOfContents.spec.group).toBe("block");
    editor.destroy();
  });

  it("inserts TOC via insertTableOfContents command", () => {
    const editor = createTestEditor("<p>Before</p><p>After</p>");
    editor.commands.setTextSelection(7);
    const success = editor.commands.insertTableOfContents();
    expect(success).toBe(true);

    const json = editor.getJSON();
    const tocNode = json.content?.find(
      (n: Record<string, unknown>) => n.type === "tableOfContents"
    );
    expect(tocNode).toBeDefined();
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Heading scanner tests
// ---------------------------------------------------------------------------

describe("scanHeadings", () => {
  it("returns empty array for document without headings", () => {
    const editor = createTestEditor("<p>Just a paragraph</p>");
    const headings = scanHeadings(editor.state.doc);
    expect(headings).toEqual([]);
    editor.destroy();
  });

  it("extracts H1-H3 headings in order", () => {
    const md = "# Chapter 1\n\nSome text\n\n## Section A\n\nMore text\n\n### Subsection\n\nContent";
    const editor = createTestEditor(md);
    const headings = scanHeadings(editor.state.doc);

    expect(headings).toHaveLength(3);
    expect(headings[0]).toMatchObject({ level: 1, text: "Chapter 1" });
    expect(headings[1]).toMatchObject({ level: 2, text: "Section A" });
    expect(headings[2]).toMatchObject({ level: 3, text: "Subsection" });
    editor.destroy();
  });

  it("ignores H4-H6 headings", () => {
    const md = "# H1\n\n#### H4\n\n##### H5\n\n###### H6\n\n## H2";
    const editor = createTestEditor(md);
    const headings = scanHeadings(editor.state.doc);

    expect(headings).toHaveLength(2);
    expect(headings[0]).toMatchObject({ level: 1, text: "H1" });
    expect(headings[1]).toMatchObject({ level: 2, text: "H2" });
    editor.destroy();
  });

  it("captures heading text content correctly", () => {
    const md = "# Title with **bold** text\n\n## Another heading";
    const editor = createTestEditor(md);
    const headings = scanHeadings(editor.state.doc);

    expect(headings).toHaveLength(2);
    // ProseMirror textContent joins inline content
    expect(headings[0].text).toBe("Title with bold text");
    expect(headings[1].text).toBe("Another heading");
    editor.destroy();
  });

  it("includes position data for each heading", () => {
    const md = "# First\n\n## Second";
    const editor = createTestEditor(md);
    const headings = scanHeadings(editor.state.doc);

    expect(headings).toHaveLength(2);
    // Each heading should have a pos > 0
    expect(headings[0].pos).toBeGreaterThanOrEqual(0);
    expect(headings[1].pos).toBeGreaterThan(headings[0].pos);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// Markdown round-trip tests
// ---------------------------------------------------------------------------

describe("TOC markdown round-trip", () => {
  it("convertTocToHtml converts <!-- toc --> to HTML div", () => {
    const input = "# Title\n\n<!-- toc -->\n\n## Section";
    const result = convertTocToHtml(input);
    expect(result).toContain('<div data-toc="true"');
    expect(result).not.toContain("<!-- toc -->");
  });

  it("convertTocToHtml leaves other comments untouched", () => {
    const input = "<!-- pagebreak -->\n\n<!-- some other comment -->";
    const result = convertTocToHtml(input);
    expect(result).toContain("<!-- pagebreak -->");
    expect(result).toContain("<!-- some other comment -->");
  });

  it("restoreTocComments converts HTML div back to comment", () => {
    const input = '<div data-toc="true" class="toc-block"></div>';
    const result = restoreTocComments(input);
    expect(result).toBe("<!-- toc -->");
  });

  it("serializes TOC node back to <!-- toc -->", () => {
    const md = "# Title\n\n<!-- toc -->\n\n## Section";
    const editor = createTestEditor(md);
    const output = getMarkdown(editor);

    expect(output).toContain("<!-- toc -->");
    editor.destroy();
  });
});
