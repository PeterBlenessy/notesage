/**
 * Regression tests for the CodeMirror theme used in source mode.
 *
 * Issue #166: The source-mode (CodeMirror) editor cuts off the last few lines
 * because the .cm-content element has no bottom padding, allowing fixed-position
 * chrome (StatusBar) to overlap the scrollable content.
 */
import { describe, it, expect } from "vitest";

// Import the theme to inspect its generated CSS text via CodeMirror's
// StyleModule.getRules() method, which is accessible by walking the extension
// data structure.
import { notesageTheme } from "../codemirror-theme";

/**
 * Extract the generated CSS string from a CodeMirror Extension produced by
 * EditorView.theme(). CodeMirror builds a StyleModule internally; the module
 * exposes a getRules() method that returns the complete CSS text.
 */
function extractThemeCSS(extension: unknown): string {
  const visited = new Set<unknown>();

  function walk(node: unknown): string {
    if (!node || typeof node !== "object") return "";
    if (visited.has(node)) return "";
    visited.add(node);

    // StyleModule has a getRules() method
    if (typeof (node as { getRules?: unknown }).getRules === "function") {
      return (node as { getRules: () => string }).getRules();
    }

    if (Array.isArray(node)) {
      return node.map(walk).join("\n");
    }

    return Object.values(node as Record<string, unknown>)
      .map(walk)
      .join("\n");
  }

  return walk(extension);
}

/**
 * Parse a CSS length value like "16px", "0px", "0", "24px" → number (px).
 * Returns 0 for bare "0" (valid CSS, means 0px).
 */
function parsePx(value: string): number {
  if (value === "0") return 0;
  const m = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Extract the effective bottom padding (in px) from the CSS rules string for
 * the .cm-content selector. Handles both explicit `padding-bottom` and
 * 3/4-value `padding` shorthand (with or without trailing `px` on zero).
 */
function extractCmContentBottomPadding(css: string): number {
  // Narrow to the .cm-content rule block if possible
  const blockMatch = /\.cm-content\s*\{([^}]*)\}/.exec(css);
  const block = blockMatch ? blockMatch[1] : css;

  // Explicit padding-bottom property (wins over shorthand in CSS cascade, but
  // here we just want whatever is declared):
  const pbPropMatch = /padding-bottom\s*:\s*([^;]+);?/.exec(block);
  if (pbPropMatch) {
    return parsePx(pbPropMatch[1].trim());
  }

  // Shorthand: padding: <top> <right> <bottom> <left>
  // Values may be "0" (no unit) or "Npx".
  const pxOrZero = "(?:\\d+(?:\\.\\d+)?px|0)";
  const shorthand4Re = new RegExp(
    `padding\\s*:\\s*(${pxOrZero})\\s+(${pxOrZero})\\s+(${pxOrZero})\\s+(${pxOrZero})`,
  );
  const s4 = shorthand4Re.exec(block);
  if (s4) return parsePx(s4[3]); // 3rd value = bottom

  // Shorthand: padding: <top> <left-right> <bottom>
  const shorthand3Re = new RegExp(
    `padding\\s*:\\s*(${pxOrZero})\\s+(${pxOrZero})\\s+(${pxOrZero})(?:\\s|;|$)`,
  );
  const s3 = shorthand3Re.exec(block);
  if (s3) return parsePx(s3[3]); // 3rd value = bottom

  return 0;
}

/**
 * Extract the effective top padding (in px) from the CSS rules string for
 * the .cm-content selector.
 */
function extractCmContentTopPadding(css: string): number {
  const blockMatch = /\.cm-content\s*\{([^}]*)\}/.exec(css);
  const block = blockMatch ? blockMatch[1] : css;

  const ptPropMatch = /padding-top\s*:\s*([^;]+);?/.exec(block);
  if (ptPropMatch) {
    return parsePx(ptPropMatch[1].trim());
  }

  const pxOrZero = "(?:\\d+(?:\\.\\d+)?px|0)";
  const shorthand4Re = new RegExp(
    `padding\\s*:\\s*(${pxOrZero})\\s+(${pxOrZero})\\s+(${pxOrZero})\\s+(${pxOrZero})`,
  );
  const s4 = shorthand4Re.exec(block);
  if (s4) return parsePx(s4[1]); // 1st value = top

  const shorthand3Re = new RegExp(
    `padding\\s*:\\s*(${pxOrZero})\\s+(${pxOrZero})\\s+(${pxOrZero})(?:\\s|;|$)`,
  );
  const s3 = shorthand3Re.exec(block);
  if (s3) return parsePx(s3[1]); // 1st value = top

  return 0;
}

describe("notesageTheme — source mode bottom padding (#166)", () => {
  it("the .cm-content rule defines a paddingBottom of at least 24px so the StatusBar cannot clip the last line", () => {
    const css = extractThemeCSS(notesageTheme);
    const bottom = extractCmContentBottomPadding(css);

    expect(
      bottom,
      `Expected .cm-content bottom padding >= 24px so the last line is not hidden behind the StatusBar.\n` +
        `Found: ${bottom}px.\n\n` +
        `Current .cm-content rule:\n${(/\.cm-content\s*\{[^}]*\}/.exec(css) ?? ["(no block found)"])[0]}`,
    ).toBeGreaterThanOrEqual(24);
  });

  it("the .cm-content rule retains the existing top padding of 16px (no regression)", () => {
    const css = extractThemeCSS(notesageTheme);
    const top = extractCmContentTopPadding(css);

    expect(
      top,
      `Expected .cm-content top padding == 16px. Found: ${top}px.\n\n` +
        `Current .cm-content rule:\n${(/\.cm-content\s*\{[^}]*\}/.exec(css) ?? ["(no block found)"])[0]}`,
    ).toBe(16);
  });
});
