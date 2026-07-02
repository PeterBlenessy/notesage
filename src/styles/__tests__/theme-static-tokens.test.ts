import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * Regression lock for the light-mode editor-token pruning bug.
 *
 * `globals.css` imports Tailwind with `source(none)` and only globs
 * `.ts/.tsx/.js/.jsx/.html` as `@source`. Editor-content tokens such as the
 * `--color-callout-*` fills are consumed ONLY via `var(--…)` inside
 * `editor.css` (a plain stylesheet Tailwind never scans). Without `@theme
 * static`, Tailwind tree-shakes those tokens' base (light) values out of the
 * production `:root`, because it sees no utility using them — while their
 * `.dark`/`.soft` overrides (plain CSS blocks) survive. The result was a
 * light-mode-only bug: callout fills silently vanished in `vite build` output.
 *
 * `@theme static` forces every theme variable to be emitted. If someone
 * reverts it to plain `@theme`, this test fails before the bug ships again.
 */
describe("globals.css theme tokens", () => {
  const globals = readFileSync(
    path.join(process.cwd(), "src/styles/globals.css"),
    "utf8",
  );

  it("uses `@theme static` so editor-only tokens survive the production build", () => {
    expect(globals).toMatch(/@theme\s+static\b/);
  });

  it("declares the callout fill tokens that editor.css consumes", () => {
    for (const t of [
      "--color-callout-note-bg",
      "--color-callout-tip-bg",
      "--color-callout-warning-bg",
      "--color-callout-important-bg",
    ]) {
      expect(globals).toContain(t);
    }
  });
});
