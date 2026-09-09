import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Locator hygiene for the mobile suite (#936).
 *
 * Twice now a locator that named an element by its presentation class has
 * been silently redirected at the wrong element by an unrelated bit of UI
 * landing above it: `svg.h-5.w-5` for the pull-to-refresh indicator and
 * `scrollers[0]` for the listing's scroller both started matching the pinned
 * Recordings card's mic instead. Neither failed — they asserted happily
 * against the wrong node, which is the expensive kind of wrong.
 *
 * The rule that stops it:
 *
 *   An assertion that names ONE specific element reaches it by test id.
 *   Only an assertion whose point is to be exhaustive over a category
 *   queries by class — and then it counts, so being exhaustive is visible.
 *
 * Mechanically: a singular `querySelector` may select by tag, test id or
 * another semantic attribute, never by a bare class. `querySelectorAll` is
 * left alone; being exhaustive is exactly what it is for.
 */
const DIR = __dirname;

/** `x.querySelector("<selector>")` — not `querySelectorAll`. */
const SINGULAR = /\.querySelector(?!All)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]*)\1/g;

/** A selector that leads with `.foo` — a class, i.e. how something looks. */
function leadsWithClass(selector: string): boolean {
  return /^\s*\./.test(selector);
}

function testFiles(): string[] {
  return readdirSync(DIR)
    .filter((f) => /\.test\.tsx?$/.test(f) && f !== "locator-hygiene.test.ts")
    .sort();
}

describe("mobile tests locate elements by name, not by looks", () => {
  it("has test files to check", () => {
    expect(testFiles().length).toBeGreaterThan(0);
  });

  it("never grabs a single element by its presentation class", () => {
    const offenders: string[] = [];
    for (const file of testFiles()) {
      const src = readFileSync(resolve(DIR, file), "utf8");
      for (const m of src.matchAll(SINGULAR)) {
        const selector = m[2];
        if (!leadsWithClass(selector)) continue;
        const line = src.slice(0, m.index ?? 0).split("\n").length;
        offenders.push(`${file}:${line} querySelector("${selector}")`);
      }
    }
    expect(
      offenders,
      "Reach a specific element by test id. If the point is to be exhaustive " +
        "over a category, use querySelectorAll and assert the count.",
    ).toEqual([]);
  });
});
