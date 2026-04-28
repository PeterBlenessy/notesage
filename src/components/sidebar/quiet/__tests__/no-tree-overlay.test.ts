// Sidebar-simplification task #21 — smoke test for the
// TreeOverlay deletion. The component / store / capture-phase
// listener / prop chain were removed in #20. This test fails if
// any of those reappear under `src/`, so a future refactor can't
// silently re-introduce the dependency the deletion was meant to
// remove.
//
// Excluded:
//   - This file itself (the assertion strings live here)
//   - The audit + task-file markdown under `docs/` (intentional
//     references to the deletion)
//   - Code comments that reference the deletion in past-tense
//     ("// useTreeOverlayStore was removed by sidebar #20") — those
//     are documentation, not active references. We grep for the
//     ACTUAL reintroduction signals: `import` statements and
//     `useTreeOverlayStore.` member access on the store object.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..", "..", "..", "src");
const SELF = join(__dirname, "no-tree-overlay.test.ts");

function walk(dir: string, hits: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      // Skip node_modules / dist artifacts that may live in src in dev.
      if (name === "node_modules" || name === ".vite") continue;
      walk(full, hits);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      hits.push(full);
    }
  }
  return hits;
}

describe("TreeOverlay deletion smoke test (sidebar #21)", () => {
  const files = walk(SRC).filter((f) => f !== SELF);

  it("no remaining import of @/stores/tree-overlay-store", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Match real imports — `import ... from "@/stores/tree-overlay-store"`
      // or `import("@/stores/tree-overlay-store")`. Prose comments
      // mentioning the path are OK.
      if (/from\s+['"]@\/stores\/tree-overlay-store['"]/.test(src)) {
        offenders.push(f);
      }
      if (/import\s*\(\s*['"]@\/stores\/tree-overlay-store['"]/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no remaining import of the TreeOverlay component", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      if (/from\s+['"]@\/components\/sidebar\/quiet\/TreeOverlay['"]/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no remaining call to useTreeOverlayStore.* (member access)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // Match `useTreeOverlayStore(`, `useTreeOverlayStore.`, or
      // `useTreeOverlayStore<` (TS generics). Naked identifier in
      // comments is allowed.
      if (/useTreeOverlayStore\s*[(.<]/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders).toEqual([]);
  });
});
