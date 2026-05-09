/**
 * Performance benchmarks for search and decoration rebuild operations.
 *
 * Tests findMatches() for search highlight decorations and
 * buildTagDecorations() for tag highlight decorations using
 * fixture files of varying sizes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { benchmark, createTestEditor, setupJSDOM } from "./harness";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  setupJSDOM();
});

// ---------------------------------------------------------------------------
// Inline implementations of the functions we're benchmarking.
// We inline them to avoid importing the full extensions which register
// ProseMirror plugins with side effects.
// ---------------------------------------------------------------------------

/** Matches the findMatches() logic from search-highlight.ts */
function findMatches(doc: PMNode, query: string): { from: number; to: number }[] {
  if (!query) return [];

  const matches: { from: number; to: number }[] = [];
  const lowerQuery = query.toLowerCase();

  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !node.text) return;

    const lowerText = node.text.toLowerCase();
    let searchFrom = 0;

    while (searchFrom < lowerText.length) {
      const idx = lowerText.indexOf(lowerQuery, searchFrom);
      if (idx === -1) break;
      matches.push({ from: pos + idx, to: pos + idx + query.length });
      searchFrom = idx + 1;
    }
  });

  return matches;
}

/** Build search decorations from matches (mirrors buildDecorations in search-highlight.ts) */
function buildSearchDecorations(
  doc: PMNode,
  matches: { from: number; to: number }[],
  currentIndex: number
): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const isActive = i === currentIndex;
    decorations.push(
      Decoration.inline(match.from, match.to, {
        class: isActive ? "find-match find-match-active" : "find-match",
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

const TAG_RE = /(?:^|(?:[^\w]))#([a-zA-Z][a-zA-Z0-9_-]*)/g;

/** Matches the buildTagDecorations() logic from tag-highlight.ts */
function buildTagDecorations(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name === "codeBlock") return false;
    if (!node.isText || !node.text) return;
    if (node.marks.some((m) => m.type.name === "code")) return;

    const text = node.text;
    TAG_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = TAG_RE.exec(text)) !== null) {
      const tagName = match[1];
      const fullMatch = match[0];
      const hashOffset = fullMatch.lastIndexOf("#");
      const from = pos + match.index + hashOffset;
      const to = from + 1 + tagName.length;

      decorations.push(
        Decoration.inline(from, to, {
          class: "tag-badge",
          "data-tag": tagName,
        })
      );
    }
  });

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------

const fixturesDir = join(__dirname, "../../tests/fixtures/perf");

const fixtures = [
  { name: "1KB", file: "perf-1kb.md", searchBudget: 1, tagBudget: 1 },
  { name: "10KB", file: "perf-10kb.md", searchBudget: 1, tagBudget: 1 },
  { name: "50KB", file: "perf-50kb.md", searchBudget: 2, tagBudget: 1 },
  { name: "100KB", file: "perf-100kb.md", searchBudget: 2, tagBudget: 1 },
];

// Pre-create editors and cache ProseMirror docs
const docs = new Map<string, PMNode>();

beforeAll(() => {
  for (const { file } of fixtures) {
    const content = readFileSync(join(fixturesDir, file), "utf-8");
    const editor = createTestEditor(content);
    docs.set(file, editor.state.doc);
    editor.destroy();
  }
});

// ---------------------------------------------------------------------------
// Search decoration benchmarks
// ---------------------------------------------------------------------------

describe("search decoration rebuild", () => {
  for (const { name, file, searchBudget } of fixtures) {
    it(`findMatches + buildDecorations for ${name} within ${searchBudget}ms budget`, async () => {
      const doc = docs.get(file)!;

      const result = await benchmark(
        `search decorations ${name}`,
        () => {
          const matches = findMatches(doc, "the");
          buildSearchDecorations(doc, matches, 0);
        },
        searchBudget
      );

      expect(result.passed).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Tag decoration benchmarks
// ---------------------------------------------------------------------------

describe("tag decoration rebuild", () => {
  for (const { name, file, tagBudget } of fixtures) {
    it(`buildTagDecorations for ${name} within ${tagBudget}ms budget`, async () => {
      const doc = docs.get(file)!;

      const result = await benchmark(
        `tag decorations ${name}`,
        () => {
          buildTagDecorations(doc);
        },
        tagBudget
      );

      expect(result.passed).toBe(true);
    });
  }
});
