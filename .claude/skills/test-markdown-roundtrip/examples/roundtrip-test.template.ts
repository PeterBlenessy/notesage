/**
 * TEMPLATE — Markdown round-trip test shape.
 *
 * Canonical shape for a round-trip test loop. Update this file when the
 * intended pattern changes, NOT when new extensions are added (those go in
 * the real test at src/lib/__tests__/markdown-roundtrip.test.ts).
 *
 * Each fixture is verified with two passes:
 *   1. input → parse → serialize  ;  assert output matches input (canonical)
 *   2. pass1 → parse → serialize  ;  assert output matches pass1 (idempotent)
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

// jsdom bootstrap — ProseMirror needs a global DOM.
let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
  // Add other globals if your extensions need them (Node, HTMLElement, etc.)
});

function normalizeWhitespace(text: string): string {
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function createTestEditor(content: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit,
      Markdown.configure({ html: true, linkify: false }),
      // Add any extension whose markdown serialization you need to exercise.
    ],
    content,
    editable: false,
  });
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

const fixturesDir = join(__dirname, "../../../tests/fixtures");
const fixtureFiles = readdirSync(fixturesDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

describe("Markdown round-trip", () => {
  for (const file of fixtureFiles) {
    it(`round-trips ${file}`, () => {
      const input = readFileSync(join(fixturesDir, file), "utf-8");

      const e1 = createTestEditor(input);
      const pass1 = getMarkdown(e1);
      e1.destroy();

      const e2 = createTestEditor(pass1);
      const pass2 = getMarkdown(e2);
      e2.destroy();

      // Idempotence — the serializer produces stable output
      expect(normalizeWhitespace(pass2)).toBe(normalizeWhitespace(pass1));
      // Canonicalization — fixture matches serializer's canonical output
      expect(normalizeWhitespace(pass1)).toBe(normalizeWhitespace(input));
    });
  }
});
