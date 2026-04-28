// Quick Capture removal smoke test
// (PRD `2026-04-28-cmd-bar-verb-prefixes` task #13).
//
// Quick Capture was advertised in the System Tray phase but never
// shipped — no global-shortcut plugin, no separate window. Audit
// finding #2 from `docs/audits/2026-04-27-quiet-composer-migration.md`
// resolved as "removed, not built". This test fails if any of the
// removed identifiers reappear under `src/`, so a future palette
// refactor can't silently re-add the false promise.
//
// Excluded:
//   - This file itself (the assertion strings live here)
//   - Doc / audit / PRD markdown under `docs/` — historical references
//     to the removal are intentional
//   - Code comments mentioning the removal in past-tense — those are
//     documentation, not active references. We grep for ACTUAL
//     reintroduction signals: identifier-shaped strings inside live
//     code (palette ids, case-branch labels, component names).

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..", "src");
const SELF = join(__dirname, "no-quick-capture.test.ts");

function walk(dir: string, hits: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".vite") continue;
      walk(full, hits);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      hits.push(full);
    }
  }
  return hits;
}

describe("Quick Capture removal smoke test (verb-prefixes #13)", () => {
  const files = walk(SRC).filter((f) => f !== SELF);

  it("no `quick-capture` palette id literal", () => {
    // The PaletteMode entry used `id: 'quick-capture'`. Match the
    // quoted string in either single or double quotes — naked
    // identifiers in prose comments are tolerated.
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/['"]quick-capture['"]/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("no `QuickCapture` component / type identifier", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // PascalCase identifier as a JSX tag, type ref, or class. Word-
      // boundary anchors avoid matching `QuickCapture` substrings of
      // unrelated identifiers.
      if (/\bQuickCapture\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("no `quickCapture` camelCase store / variable identifier", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/\bquickCapture\b/.test(src)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
