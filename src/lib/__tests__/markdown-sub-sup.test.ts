/**
 * Tests for subscript (~sub~) and superscript (^sup^) markdown round-tripping.
 *
 * Verifies:
 * - ~sub~ parses to subscript mark
 * - ~~strike~~ still parses to strikethrough (no conflict!)
 * - ^sup^ parses to superscript mark
 * - Neither parses inside backtick code spans
 * - Round-trip: parse -> serialize -> compare
 * - Edge case: nested marks
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import markdownitSub from "markdown-it-sub";
import markdownitSup from "markdown-it-sup";

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
      StarterKit,
      Markdown.configure({ html: true, linkify: false }),
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
    content,
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
// Tests
// ---------------------------------------------------------------------------

describe("Subscript markdown (~sub~)", () => {
  it("parses ~sub~ to subscript mark", () => {
    const editor = createTestEditor("H~2~O is water");
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const marks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(marks?.some((m: { type: string }) => m.type === "subscript")).toBe(true);
    editor.destroy();
  });

  it("round-trips ~sub~ through parse and serialize", () => {
    const input = "H~2~O is water";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
    editor.destroy();
  });

  it("does not parse ~sub~ inside backtick code spans", () => {
    const input = "`H~2~O` is code";
    const editor = createTestEditor(input);
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const marks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(marks?.some((m: { type: string }) => m.type === "subscript")).toBe(false);
    editor.destroy();
  });
});

describe("Superscript markdown (^sup^)", () => {
  it("parses ^sup^ to superscript mark", () => {
    const editor = createTestEditor("x^2^ is x squared");
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const marks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(marks?.some((m: { type: string }) => m.type === "superscript")).toBe(true);
    editor.destroy();
  });

  it("round-trips ^sup^ through parse and serialize", () => {
    const input = "x^2^ is x squared";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
    editor.destroy();
  });

  it("does not parse ^sup^ inside backtick code spans", () => {
    const input = "`x^2^` is code";
    const editor = createTestEditor(input);
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const marks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(marks?.some((m: { type: string }) => m.type === "superscript")).toBe(false);
    editor.destroy();
  });
});

describe("Strikethrough ~~strike~~ does not conflict with ~sub~", () => {
  it("~~text~~ still parses as strikethrough, not subscript", () => {
    const editor = createTestEditor("~~deleted~~ text");
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const marks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(marks?.some((m: { type: string }) => m.type === "strike")).toBe(true);
    expect(marks?.some((m: { type: string }) => m.type === "subscript")).toBe(false);
    editor.destroy();
  });

  it("round-trips ~~strikethrough~~ correctly", () => {
    const input = "~~deleted~~ text";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    expect(normalizeWhitespace(output)).toBe(normalizeWhitespace(input));
    editor.destroy();
  });

  it("handles ~sub~ and ~~strike~~ in the same paragraph", () => {
    const input = "H~2~O and ~~deleted~~";
    const editor = createTestEditor(input);
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const marks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(marks?.some((m: { type: string }) => m.type === "subscript")).toBe(true);
    expect(marks?.some((m: { type: string }) => m.type === "strike")).toBe(true);
    editor.destroy();
  });
});

describe("Nested marks", () => {
  it("handles **bold ~sub~** (subscript inside bold)", () => {
    const input = "**bold ~sub~**";
    const editor = createTestEditor(input);
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const allMarks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(allMarks?.some((m: { type: string }) => m.type === "subscript")).toBe(true);
    expect(allMarks?.some((m: { type: string }) => m.type === "bold")).toBe(true);
    editor.destroy();
  });

  it("handles *italic ^sup^* (superscript inside italic)", () => {
    const input = "*italic ^sup^*";
    const editor = createTestEditor(input);
    const json = editor.getJSON();
    const paragraph = json.content?.[0];
    const allMarks = paragraph?.content?.flatMap((n: Record<string, unknown>) =>
      (n.marks as Array<{ type: string }>) ?? []
    );
    expect(allMarks?.some((m: { type: string }) => m.type === "superscript")).toBe(true);
    expect(allMarks?.some((m: { type: string }) => m.type === "italic")).toBe(true);
    editor.destroy();
  });
});
