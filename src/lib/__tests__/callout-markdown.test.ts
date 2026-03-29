/**
 * Tests for callout markdown preprocessing and serialization.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Callout } from "@/components/editor/extensions/callout";
import { convertCalloutsToHtml } from "@/lib/markdown";

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
      Callout,
    ],
    content: convertCalloutsToHtml(content),
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

describe("convertCalloutsToHtml", () => {
  it("converts note callout to HTML div", () => {
    const input = "> [!note]\n> This is a note.";
    const result = convertCalloutsToHtml(input);
    expect(result).toContain('class="callout callout-note"');
    expect(result).toContain("This is a note.");
  });

  it("converts all four types", () => {
    for (const type of ["note", "tip", "warning", "important"]) {
      const input = `> [!${type}]\n> Content.`;
      const result = convertCalloutsToHtml(input);
      expect(result).toContain(`callout-${type}`);
    }
  });

  it("handles case-insensitive type", () => {
    const input = "> [!NOTE]\n> Uppercase.";
    const result = convertCalloutsToHtml(input);
    expect(result).toContain("callout-note");
  });

  it("handles mixed case type", () => {
    const input = "> [!Tip]\n> Mixed case.";
    const result = convertCalloutsToHtml(input);
    expect(result).toContain("callout-tip");
  });

  it("extracts custom title", () => {
    const input = "> [!tip] Pro Tip\n> Helpful info.";
    const result = convertCalloutsToHtml(input);
    expect(result).toContain('data-title="Pro Tip"');
  });

  it("preserves regular blockquotes", () => {
    const input = "> This is a regular blockquote.";
    const result = convertCalloutsToHtml(input);
    expect(result).toBe(input);
    expect(result).not.toContain("callout");
  });

  it("preserves blockquotes with invalid callout type", () => {
    const input = "> [!custom]\n> Invalid type.";
    const result = convertCalloutsToHtml(input);
    expect(result).not.toContain('class="callout');
    expect(result).toBe(input);
  });

  it("handles multi-paragraph callouts", () => {
    const input = "> [!note]\n> First paragraph.\n>\n> Second paragraph.";
    const result = convertCalloutsToHtml(input);
    expect(result).toContain("callout-note");
    expect(result).toContain("First paragraph.");
    expect(result).toContain("Second paragraph.");
  });

  it("does not affect content before or after callout", () => {
    const input = "Before.\n\n> [!tip]\n> Content.\n\nAfter.";
    const result = convertCalloutsToHtml(input);
    expect(result).toContain("Before.");
    expect(result).toContain("After.");
    expect(result).toContain("callout-tip");
  });
});

// ---------------------------------------------------------------------------
// Round-trip tests (parse → serialize → compare)
// ---------------------------------------------------------------------------

describe("Callout round-trip", () => {
  it("round-trips a note callout", () => {
    const input = "> [!note]\n> This is a note.";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();
    expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
  });

  it("round-trips a tip with custom title", () => {
    const input = "> [!tip] Pro Tip\n> This is helpful.";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();
    expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
  });

  it("round-trips all four types", () => {
    for (const type of ["note", "tip", "warning", "important"]) {
      const input = `> [!${type}]\n> Content for ${type}.`;
      const editor = createTestEditor(input);
      const output = getMarkdown(editor);
      editor.destroy();
      expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
    }
  });

  it("preserves regular blockquote without converting", () => {
    const input = "> This is a regular blockquote.";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();
    expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
  });

  it("is idempotent (second pass matches first)", () => {
    const input = "> [!warning] Watch Out\n> Be careful with this.";
    const editor1 = createTestEditor(input);
    const pass1 = getMarkdown(editor1);
    editor1.destroy();

    const editor2 = createTestEditor(pass1);
    const pass2 = getMarkdown(editor2);
    editor2.destroy();

    expect(normalizeWhitespace(pass2)).toBe(normalizeWhitespace(pass1));
  });
});
