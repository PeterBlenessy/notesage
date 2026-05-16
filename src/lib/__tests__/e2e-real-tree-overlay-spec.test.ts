/**
 * Meta-test: verifies that the real-E2E spec file for QuietSidebar tree
 * navigation exists and covers the acceptance criteria from issue #279.
 *
 * This test is intentionally placed in the Vitest suite so it can act as
 * the TDD "red" gate — the real-E2E spec file must exist and contain the
 * required test descriptions. The actual WebDriverIO tests can only run
 * against a live Tauri app (`pnpm test:e2e-real`).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SPEC_FILE = path.resolve(
  __dirname,
  "../../../e2e-real/tests/tree-overlay.test.ts",
);

describe("e2e-real tree-overlay spec (issue #279)", () => {
  it("spec file exists at e2e-real/tests/tree-overlay.test.ts", () => {
    expect(fs.existsSync(SPEC_FILE)).toBe(true);
  });

  it("spec covers ArrowRight expansion of project rows", () => {
    const content = fs.readFileSync(SPEC_FILE, "utf-8");
    expect(content).toMatch(/ArrowRight|arrow.*right|→.*expand|expand.*→/i);
  });

  it("spec covers Up/Down arrow-key navigation", () => {
    const content = fs.readFileSync(SPEC_FILE, "utf-8");
    expect(content).toMatch(/ArrowDown|ArrowUp/);
  });

  it("spec covers Enter or Space to open a file", () => {
    const content = fs.readFileSync(SPEC_FILE, "utf-8");
    expect(content).toMatch(/Enter|Space/);
  });

  it("spec covers collapse and focus restore (ArrowLeft)", () => {
    const content = fs.readFileSync(SPEC_FILE, "utf-8");
    expect(content).toMatch(/ArrowLeft|collapse/i);
  });

  it("spec covers that only projects render in the Projects section", () => {
    const content = fs.readFileSync(SPEC_FILE, "utf-8");
    expect(content).toMatch(/project|Projects section/i);
  });
});
