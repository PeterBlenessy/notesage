/**
 * Tests for link preview markdown preprocessing and serialization.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { LinkPreview } from "@/components/editor/extensions/link-preview";
import { Callout } from "@/components/editor/extensions/callout";
import { convertLinkPreviewsToHtml, convertCalloutsToHtml } from "@/lib/markdown";

// ---------------------------------------------------------------------------
// jsdom bootstrap
// ---------------------------------------------------------------------------

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="editor"></div></body></html>');
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement = dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
  globalThis.getComputedStyle = dom.window.getComputedStyle as unknown as typeof getComputedStyle;
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
      LinkPreview,
      Callout,
    ],
    content: convertLinkPreviewsToHtml(convertCalloutsToHtml(content)),
    editable: false,
  });
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Preprocessor tests
// ---------------------------------------------------------------------------

describe("convertLinkPreviewsToHtml", () => {
  it("converts link preview to HTML div", () => {
    const input = "> [!link](https://example.com)\n> **Title**\n> Description\n> example.com";
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toContain('data-link-preview="https://example.com"');
    expect(result).toContain('data-title="Title"');
    expect(result).toContain('data-description="Description"');
    expect(result).toContain('data-site-name="example.com"');
  });

  it("handles URL-only link preview", () => {
    const input = "> [!link](https://example.com)";
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toContain('data-link-preview="https://example.com"');
    expect(result).not.toContain("data-title");
  });

  it("handles link preview with title only", () => {
    const input = "> [!link](https://example.com)\n> **My Title**";
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toContain('data-title="My Title"');
    expect(result).not.toContain("data-description");
    expect(result).not.toContain("data-site-name");
  });

  it("preserves regular blockquotes", () => {
    const input = "> This is a regular blockquote.";
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toBe(input);
    expect(result).not.toContain("data-link-preview");
  });

  it("preserves callout blockquotes", () => {
    const input = "> [!note]\n> This is a note.";
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toBe(input);
    expect(result).not.toContain("data-link-preview");
  });

  it("handles multiple link previews", () => {
    const input = "> [!link](https://one.com)\n> **One**\n\n> [!link](https://two.com)\n> **Two**";
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toContain('data-link-preview="https://one.com"');
    expect(result).toContain('data-link-preview="https://two.com"');
  });

  it("escapes angle brackets in attributes", () => {
    const input = '> [!link](https://example.com)\n> **Title with <tags>**';
    const result = convertLinkPreviewsToHtml(input);
    expect(result).toContain("&lt;tags&gt;");
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests (parse → serialize)
// ---------------------------------------------------------------------------

describe("link preview round-trip", () => {
  it("round-trips full metadata", () => {
    const input = `> [!link](https://example.com)
> **Example Title**
> A description of the page
> example.com`;

    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(normalizeWhitespace(output)).toContain("[!link](https://example.com)");
    expect(normalizeWhitespace(output)).toContain("**Example Title**");
    expect(normalizeWhitespace(output)).toContain("A description of the page");
    expect(normalizeWhitespace(output)).toContain("example.com");
  });

  it("round-trips URL-only link preview", () => {
    const input = "> [!link](https://minimal.example.com)";

    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(normalizeWhitespace(output)).toContain("[!link](https://minimal.example.com)");
  });

  it("does not affect regular blockquotes", () => {
    const input = "> This is a regular blockquote.";

    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(normalizeWhitespace(output)).toContain("> This is a regular blockquote.");
    expect(output).not.toContain("[!link]");
  });

  it("does not affect callouts", () => {
    const input = "> [!note]\n> This is a note.";

    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(normalizeWhitespace(output)).toContain("[!note]");
    expect(output).not.toContain("[!link]");
  });
});

// ---------------------------------------------------------------------------
// URL detection regex tests
// ---------------------------------------------------------------------------

describe("URL detection", () => {
  const urlRe = /^https?:\/\/\S+$/;

  it("matches valid HTTP URLs", () => {
    expect(urlRe.test("https://example.com")).toBe(true);
    expect(urlRe.test("http://example.com/path?q=1")).toBe(true);
    expect(urlRe.test("https://sub.domain.co.uk/page#anchor")).toBe(true);
  });

  it("rejects non-URLs", () => {
    expect(urlRe.test("not a url")).toBe(false);
    expect(urlRe.test("ftp://example.com")).toBe(false);
    expect(urlRe.test("example.com")).toBe(false);
    expect(urlRe.test("")).toBe(false);
    expect(urlRe.test("https://example.com some text")).toBe(false);
  });
});
