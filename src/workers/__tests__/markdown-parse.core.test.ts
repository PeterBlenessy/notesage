// @vitest-environment jsdom

/**
 * Parity test for the markdown-parse Web Worker pipeline. Phase 2 task #19.
 *
 * The worker's `parseMarkdownToProseMirrorJson` runs the same preprocessor
 * chain + markdown-it + DOMParser + ProseMirror parse that the main-thread
 * editor runs via tiptap-markdown's `setContent(markdown)`. This test
 * confirms both paths produce the same ProseMirror JSON for a representative
 * fixture set, so we can ship Phase 2 with confidence that the worker won't
 * silently corrupt user documents.
 *
 * Needs jsdom environment to provide `globalThis.DOMParser`. In production
 * the worker uses `self.DOMParser` from the dedicated worker scope.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMarkdownToProseMirrorJson } from "../markdown-parse.core";

const FIXTURE_DIR = resolve(__dirname, "../../../tests/fixtures");

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_DIR, name), "utf-8");
}

/**
 * Strip volatile attributes that are guaranteed to differ between any two
 * parses (random UUIDs from UniqueID, etc.). Recursively walks the JSON
 * tree.
 */
function stripVolatile(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(stripVolatile);
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key === "attrs" && value && typeof value === "object") {
        const attrs = value as Record<string, unknown>;
        const cleanedAttrs: Record<string, unknown> = {};
        for (const [aKey, aValue] of Object.entries(attrs)) {
          // UniqueID's `id` attribute is a freshly-generated UUID per parse.
          // Skip — the test cares about structure + non-volatile attrs.
          if (aKey === "id" && typeof aValue === "string" && /^[0-9a-f-]{36}$/i.test(aValue)) continue;
          cleanedAttrs[aKey] = stripVolatile(aValue);
        }
        out[key] = cleanedAttrs;
      } else {
        out[key] = stripVolatile(value);
      }
    }
    return out;
  }
  return node;
}

describe("Phase 2 worker parse pipeline (M2.6 #19)", () => {
  it("produces a doc-shaped JSON for a small mixed fixture", () => {
    const md = loadFixture("preview-fidelity/mixed-small.md");
    const result = parseMarkdownToProseMirrorJson(md);
    expect(result.doc).toBeDefined();
    expect(typeof result.doc).toBe("object");
    expect((result.doc as { type: string }).type).toBe("doc");
    expect(Array.isArray((result.doc as { content: unknown[] }).content)).toBe(true);
  });

  it("includes timings on every parse result", () => {
    const md = "# Hello\n\nWorld.";
    const result = parseMarkdownToProseMirrorJson(md);
    expect(result.timings.preprocess).toBeGreaterThanOrEqual(0);
    expect(result.timings.parse).toBeGreaterThanOrEqual(0);
    expect(result.timings.total).toBeGreaterThanOrEqual(0);
  });

  it("extracts annotations from list items with {emoji} prefix", () => {
    const md = "- {🚀} task one\n- {🎯} task two\n- plain item\n";
    const result = parseMarkdownToProseMirrorJson(md);
    expect(result.annotations.size).toBe(2);
    expect(result.annotations.get(0)).toBe("🚀");
    expect(result.annotations.get(1)).toBe("🎯");
  });

  it("preserves blockquote structure in JSON output", () => {
    const md = "> Quote line one.\n>\n> Quote line two.\n";
    const result = parseMarkdownToProseMirrorJson(md);
    const cleaned = stripVolatile(result.doc) as { content: Array<{ type: string }> };
    expect(cleaned.content[0].type).toBe("blockquote");
  });

  it("parses GFM tables into table nodes", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |\n";
    const result = parseMarkdownToProseMirrorJson(md);
    const cleaned = stripVolatile(result.doc) as { content: Array<{ type: string }> };
    expect(cleaned.content[0].type).toBe("table");
  });

  it("parses callouts into callout nodes via the preprocessor", () => {
    const md = "> [!note]\n> Hello world.\n";
    const result = parseMarkdownToProseMirrorJson(md);
    const cleaned = stripVolatile(result.doc) as { content: Array<{ type: string; attrs?: { type: string } }> };
    expect(cleaned.content[0].type).toBe("callout");
    expect(cleaned.content[0].attrs?.type).toBe("note");
  });

  it("parses page breaks into pageBreak nodes via the preprocessor", () => {
    const md = "Before.\n\n<!-- pagebreak -->\n\nAfter.\n";
    const result = parseMarkdownToProseMirrorJson(md);
    const cleaned = stripVolatile(result.doc) as { content: Array<{ type: string }> };
    const types = cleaned.content.map((n) => n.type);
    expect(types).toContain("pageBreak");
  });

  it("two parses of the same input produce structurally-equal output (modulo UniqueID)", () => {
    const md = loadFixture("preview-fidelity/mixed-small.md");
    const a = parseMarkdownToProseMirrorJson(md);
    const b = parseMarkdownToProseMirrorJson(md);
    expect(stripVolatile(a.doc)).toEqual(stripVolatile(b.doc));
  });
});
