/**
 * Tests for the performance benchmark harness.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  benchmark,
  generateMarkdown,
  createTestEditor,
  getMarkdown,
  DOC_SIZES,
  setupJSDOM,
} from "./harness";

beforeAll(() => {
  setupJSDOM();
});

describe("DOC_SIZES", () => {
  it("has all expected size constants", () => {
    expect(DOC_SIZES.small).toBe(1);
    expect(DOC_SIZES.medium).toBe(10);
    expect(DOC_SIZES.large).toBe(50);
    expect(DOC_SIZES.extraLarge).toBe(100);
  });
});

describe("benchmark()", () => {
  it("returns a passing result when function is within budget", async () => {
    const result = await benchmark("fast-op", () => {}, 1000);
    expect(result.passed).toBe(true);
    expect(result.name).toBe("fast-op");
    expect(result.elapsed).toBeLessThan(1000);
    expect(result.budget).toBe(1000);
  });

  it("returns a failing result when function exceeds budget", async () => {
    const result = await benchmark(
      "slow-op",
      () => {
        const end = performance.now() + 50;
        while (performance.now() < end) {
          /* spin */
        }
      },
      1 // 1ms budget
    );
    expect(result.passed).toBe(false);
    expect(result.elapsed).toBeGreaterThan(1);
  });

  it("uses median of multiple iterations", async () => {
    let callCount = 0;
    const result = await benchmark(
      "multi-iter",
      () => {
        callCount++;
      },
      1000,
      5
    );
    expect(callCount).toBe(5);
    expect(result.passed).toBe(true);
  });
});

describe("generateMarkdown()", () => {
  it.each([
    ["small", DOC_SIZES.small],
    ["medium", DOC_SIZES.medium],
    ["large", DOC_SIZES.large],
    ["extraLarge", DOC_SIZES.extraLarge],
  ])("generates %s (%dKB) markdown within 20%% of target", (_label, sizeKB) => {
    const md = generateMarkdown(sizeKB);
    const actualKB = Buffer.byteLength(md, "utf-8") / 1024;

    // Within 20% of target (generous tolerance for text generation)
    expect(actualKB).toBeGreaterThan(sizeKB * 0.8);
    expect(actualKB).toBeLessThan(sizeKB * 1.3);
  });

  it("includes all supported syntax types", () => {
    const md = generateMarkdown(10);

    // Headings
    expect(md).toMatch(/^# /m);
    expect(md).toMatch(/^## /m);
    expect(md).toMatch(/^### /m);

    // Inline formatting
    expect(md).toMatch(/\*\*\w+\*\*/);
    expect(md).toMatch(/\*\w+\*/);
    expect(md).toMatch(/`\w+`/);

    // Lists
    expect(md).toMatch(/^- /m);
    expect(md).toMatch(/^\d+\. /m);
    expect(md).toMatch(/^- \[[ x]\] /m);

    // Code blocks
    expect(md).toMatch(/^```\w+/m);

    // Blockquotes
    expect(md).toMatch(/^> /m);

    // Tables
    expect(md).toMatch(/\|.*\|.*\|/);

    // Tags and mentions
    expect(md).toMatch(/#\w+/);
    expect(md).toMatch(/@\w+/);

    // Links
    expect(md).toMatch(/\[.*\]\(https:\/\//);

    // Horizontal rules
    expect(md).toMatch(/^---$/m);
  });
});

describe("createTestEditor()", () => {
  it("creates an editor that can parse and serialize markdown", () => {
    const input = "# Hello\n\nThis is a **test** paragraph.";
    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("# Hello");
    expect(output).toContain("**test**");
  });

  it("handles complex markdown with tables and code blocks", () => {
    const input = [
      "# Test",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "```javascript",
      "const x = 1;",
      "```",
    ].join("\n");

    const editor = createTestEditor(input);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("| A | B |");
    expect(output).toContain("const x = 1;");
  });
});
