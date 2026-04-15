/**
 * Performance benchmarks for markdown parse and serialize operations.
 *
 * Tests parsing markdown into ProseMirror documents and serializing back,
 * using fixture files of varying sizes.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  benchmark,
  createTestEditor,
  getMarkdown,
  setupJSDOM,
} from "./harness";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(() => {
  setupJSDOM();
});

// ---------------------------------------------------------------------------
// Load fixtures
// ---------------------------------------------------------------------------

const fixturesDir = join(__dirname, "../../tests/fixtures/perf");

const fixtures = [
  { name: "1KB", file: "perf-1kb.md", parseBudget: 38, serializeBudget: 3 },
  { name: "10KB", file: "perf-10kb.md", parseBudget: 100, serializeBudget: 4 },
  { name: "50KB", file: "perf-50kb.md", parseBudget: 276, serializeBudget: 15 },
  { name: "100KB", file: "perf-100kb.md", parseBudget: 508, serializeBudget: 50 },
];

// Pre-load all fixtures
const fixtureContents = new Map<string, string>();
for (const f of fixtures) {
  fixtureContents.set(f.file, readFileSync(join(fixturesDir, f.file), "utf-8"));
}

// ---------------------------------------------------------------------------
// Parse benchmarks
// ---------------------------------------------------------------------------

describe("markdown parse", () => {
  for (const { name, file, parseBudget } of fixtures) {
    it(`parses ${name} within ${parseBudget}ms budget`, async () => {
      const content = fixtureContents.get(file)!;

      const result = await benchmark(
        `parse ${name}`,
        () => {
          const editor = createTestEditor(content);
          editor.destroy();
        },
        parseBudget
      );

      expect(result.passed).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Serialize benchmarks
// ---------------------------------------------------------------------------

describe("markdown serialize", () => {
  for (const { name, file, serializeBudget } of fixtures) {
    it(`serializes ${name} within ${serializeBudget}ms budget`, async () => {
      const content = fixtureContents.get(file)!;
      // Pre-create the editor (not part of the benchmark)
      const editor = createTestEditor(content);

      const result = await benchmark(
        `serialize ${name}`,
        () => {
          const md = getMarkdown(editor);
          // Prevent dead-code elimination
          if (md.length < 0) throw new Error("unreachable");
        },
        serializeBudget
      );

      editor.destroy();
      expect(result.passed).toBe(true);
    });
  }
});
