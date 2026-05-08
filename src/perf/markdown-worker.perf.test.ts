/**
 * Performance benchmarks for the Phase 2 markdown-parse Web Worker pipeline.
 * See `docs/prds/2026-05-03-large-file-instant-load.md` § "Layer 2" and
 * Phase 2 task #21.
 *
 * Measures `parseMarkdownToProseMirrorJson` directly (not via a real Worker)
 * so we get a clean number for the parse cost itself. The wall-clock cost
 * the user sees in production includes worker spawn (~50 ms one-time) +
 * postMessage transfer + the actual parse measured here.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { benchmark } from "./harness";
import { parseMarkdownToProseMirrorJson } from "@/workers/markdown-parse.core";

// ---------------------------------------------------------------------------
// Fixtures + budgets
// ---------------------------------------------------------------------------

const fixturesDir = join(__dirname, "../../tests/fixtures/perf");

// Worker parse should be FASTER than the legacy main-thread parse (no
// expensive Tiptap-extension plugin init during parse), and main-thread
// parse already fit into these budgets. Same budgets — Phase 2 perf must
// not regress small files. Phase 4 will tune per-size thresholds for when
// the worker path is actually faster than direct parse.
const fixtures = [
  { name: "1KB", file: "perf-1kb.md", budget: 60 },
  { name: "10KB", file: "perf-10kb.md", budget: 150 },
  { name: "50KB", file: "perf-50kb.md", budget: 400 },
  { name: "100KB", file: "perf-100kb.md", budget: 800 },
];

const fixtureContents = new Map<string, string>();
for (const f of fixtures) {
  fixtureContents.set(f.file, readFileSync(join(fixturesDir, f.file), "utf-8"));
}

// ---------------------------------------------------------------------------
// Benchmark — Phase 2 worker parse pipeline
// ---------------------------------------------------------------------------

describe("worker markdown parse (Phase 2)", () => {
  for (const { name, file, budget } of fixtures) {
    it(`parses ${name} via worker pipeline within ${budget}ms`, async () => {
      const content = fixtureContents.get(file)!;

      const result = await benchmark(
        `worker-parse ${name}`,
        () => {
          const out = parseMarkdownToProseMirrorJson(content);
          // Prevent dead-code elimination — touch the result.
          if (typeof out.doc !== "object") throw new Error("unreachable");
        },
        budget,
      );

      expect(result.passed).toBe(true);
    });
  }
});
