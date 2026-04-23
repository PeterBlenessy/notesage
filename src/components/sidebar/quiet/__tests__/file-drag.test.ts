// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import { computeReorderTarget } from "../file-drag";

/**
 * Reorder math (#44). The store's `reorderPinnedFiles(from, to)` splices
 * `from` out first, then inserts at `to` in the post-removal array —
 * `computeReorderTarget` must match that semantic exactly.
 */

describe("computeReorderTarget", () => {
  it("returns null on a no-op reorder (drop on self above midpoint)", () => {
    expect(computeReorderTarget(0, 0, false)).toBeNull();
  });

  it("returns null when dropping below own row (below midpoint)", () => {
    // from=1, row=1, below → intendedTarget=2, from<2 → to=1 → null
    expect(computeReorderTarget(1, 1, true)).toBeNull();
  });

  it("returns null when inserting before the row right after you", () => {
    // from=0, row=1, above → intendedTarget=1, from<1 → to=0 → null
    expect(computeReorderTarget(0, 1, false)).toBeNull();
  });

  it("moves a later element before an earlier row", () => {
    // [A,B,C,D], move D (3) before B (1) → [A,D,B,C]
    // from=3, row=1, above → intendedTarget=1, from>=1 → to=1
    expect(computeReorderTarget(3, 1, false)).toBe(1);
  });

  it("moves an earlier element after a later row", () => {
    // [A,B,C,D], move A (0) after C (2) → [B,C,A,D]
    // from=0, row=2, below → intendedTarget=3, from<3 → to=2
    expect(computeReorderTarget(0, 2, true)).toBe(2);
  });

  it("handles new-pin append-at-index by providing from = len", () => {
    // Existing [A,B,C] + new D (index 3 after pinFile). Drop before A.
    // from=3, row=0, above → intendedTarget=0, from>=0 → to=0
    expect(computeReorderTarget(3, 0, false)).toBe(0);
  });

  it("handles new-pin append-then-reorder-to-self-position", () => {
    // Existing [A,B,C] + new D (index 3). Drop below C.
    // from=3, row=2, below → intendedTarget=3, from<3? (3<3 false) → to=3 → to===from → null
    expect(computeReorderTarget(3, 2, true)).toBeNull();
  });
});
