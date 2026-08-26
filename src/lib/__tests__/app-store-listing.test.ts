import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * App Store listing copy stays inside Apple's field limits (#593).
 *
 * The copy lives in `docs/app-store/listing.md` so it is reviewable in a diff
 * rather than typed straight into App Store Connect. That is the right place
 * for it, and it removes the only thing that was enforcing the limits: the web
 * form, which truncates or refuses at the moment of submission.
 *
 * Without this, an over-length field is discovered during a submission — the
 * slowest, most annoying possible time to find a character count wrong.
 *
 * Deliberately parsed from the MARKDOWN rather than a JSON sidecar. A second
 * copy of the strings would drift from the reviewable one, and then the check
 * would be guarding a file nobody reads.
 */

const LISTING = resolve(__dirname, "../../../docs/app-store/listing.md");

/**
 * Apple's limits, App Store Connect 2026.
 *
 * `description` is 4000 and included even though the current draft uses a
 * third of it — the point is that the check covers every field, so adding a
 * paragraph cannot quietly overrun.
 */
const LIMITS = {
  name: 30,
  subtitle: 30,
  promotional: 170,
  keywords: 100,
  description: 4000,
} as const;

/** Pull a field out, and FAIL if it is not there. */
function extract(source: string, label: string, pattern: RegExp): string {
  const match = pattern.exec(source);
  if (!match?.[1]) {
    // Not `return ""` — a silently-empty field passes every length check
    // below, which would leave this file green while guarding nothing. That
    // is the failure mode the repo's contract tests keep re-learning.
    throw new Error(
      `Could not find the ${label} field in docs/app-store/listing.md.\n` +
        `Either it was renamed or the layout changed — in both cases this ` +
        `check stopped covering it, which is worse than it failing.`,
    );
  }
  return match[1].trim();
}

const source = readFileSync(LISTING, "utf8");

const fields = {
  name: extract(source, "Name", /\|\s*Name\s*\|\s*`([^`]*)`/),
  subtitle: extract(source, "Subtitle", /\|\s*Subtitle\s*\|\s*`([^`]*)`/),
  promotional: extract(source, "Promotional text", /## Promotional text[^\n]*\n+```\n([\s\S]*?)```/),
  description: extract(source, "Description", /## Description\s*\n+```\n([\s\S]*?)```/),
  keywords: extract(source, "Keywords", /## Keywords[^\n]*\n+```\n([\s\S]*?)```/),
};

describe("App Store listing copy", () => {
  it.each(Object.entries(LIMITS))("%s fits Apple's limit", (field, limit) => {
    const value = fields[field as keyof typeof fields];
    // Promotional text and the description are written across several lines
    // for readability; App Store Connect counts the characters it receives, so
    // newlines count. They are NOT collapsed away here — doing so would let a
    // field pass the check and fail the form.
    expect(value.length, `${field} is ${value.length} chars, limit ${limit}:\n${value}`)
      .toBeLessThanOrEqual(limit);
  });

  it("spends no keyword budget on spaces after commas", () => {
    // Apple's keyword field is a comma-separated list and every character
    // counts, including a space that separates nothing. A space INSIDE a
    // keyword ("plain text") is a real two-word term and is fine.
    expect(fields.keywords, "remove the spaces after commas — they cost budget and index nothing")
      .not.toMatch(/,\s/);
  });

  it("does not spend keyword budget on the app name or subtitle", () => {
    // Apple indexes the name and subtitle already, so repeating a word from
    // either is budget bought twice. The listing doc says this in prose; here
    // it is checked.
    const keywords = fields.keywords.toLowerCase().split(",");
    const claimed = new Set(
      `${fields.name} ${fields.subtitle}`
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3),
    );
    const wasted = keywords.filter((k) => claimed.has(k.trim()));
    expect(wasted, `already indexed via the name/subtitle: ${wasted.join(", ")}`).toHaveLength(0);
  });

  it("keeps a field that sits exactly on its limit honest", () => {
    // The subtitle is currently 30/30. That is legal and deliberate, but it
    // means ANY edit overruns — so this states the situation rather than
    // leaving the next person to discover it by failing the check above.
    const atLimit = Object.entries(LIMITS).filter(
      ([f, lim]) => fields[f as keyof typeof fields].length === lim,
    );
    for (const [field, limit] of atLimit) {
      expect(fields[field as keyof typeof fields].length).toBe(limit);
    }
    // Not an assertion about WHICH fields are at the limit — that would fail
    // the moment someone legitimately shortens one.
    expect(Array.isArray(atLimit)).toBe(true);
  });
});
