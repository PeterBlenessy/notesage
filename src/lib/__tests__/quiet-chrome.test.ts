/**
 * Unit tests for the pure utility surface of `@/lib/quiet-chrome`.
 *
 * Covers: the preset table (#51) matches the PRD, `resolveQuietChromeTargets`
 * returns the preset mapping for named presets, and returns the overrides
 * verbatim when the user has flipped to "custom" mode. No DOM — the hook
 * tests live in `useQuietChrome.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  QUIET_CHROME_PRESETS,
  resolveQuietChromeTargets,
  type QuietChromeTargets,
} from "../quiet-chrome";

describe("QUIET_CHROME_PRESETS", () => {
  it("has relaxed, default, and aggressive presets", () => {
    expect(Object.keys(QUIET_CHROME_PRESETS).sort()).toEqual([
      "aggressive",
      "default",
      "relaxed",
    ]);
  });

  it("relaxed fades only toolbar + status", () => {
    expect(QUIET_CHROME_PRESETS.relaxed).toEqual<QuietChromeTargets>({
      toolbar: true,
      status: true,
      docHead: false,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    });
  });

  it("default fades toolbar + status + doc-head (sidebar and orb stay)", () => {
    expect(QUIET_CHROME_PRESETS.default).toEqual<QuietChromeTargets>({
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: false,
      orb: false,
      titlebar: false,
      cmdbar: false,
    });
  });

  it("aggressive fades everything including title bar, cmd bar, sidebar, and orb", () => {
    expect(QUIET_CHROME_PRESETS.aggressive).toEqual<QuietChromeTargets>({
      toolbar: true,
      status: true,
      docHead: true,
      sidebar: true,
      orb: true,
      titlebar: true,
      cmdbar: true,
    });
  });
});

describe("resolveQuietChromeTargets", () => {
  // Overrides that differ from every preset — used to prove that "custom"
  // actually returns the overrides verbatim and the named presets ignore
  // them completely.
  const overrides: QuietChromeTargets = {
    toolbar: false,
    status: false,
    docHead: true,
    sidebar: true,
    orb: false,
    titlebar: true,
    cmdbar: false,
  };

  it('returns PRESETS.relaxed for preset "relaxed", ignoring overrides', () => {
    expect(resolveQuietChromeTargets("relaxed", overrides)).toEqual(
      QUIET_CHROME_PRESETS.relaxed,
    );
  });

  it('returns PRESETS.default for preset "default", ignoring overrides', () => {
    expect(resolveQuietChromeTargets("default", overrides)).toEqual(
      QUIET_CHROME_PRESETS.default,
    );
  });

  it('returns PRESETS.aggressive for preset "aggressive", ignoring overrides', () => {
    expect(resolveQuietChromeTargets("aggressive", overrides)).toEqual(
      QUIET_CHROME_PRESETS.aggressive,
    );
  });

  it('returns overrides verbatim for preset "custom"', () => {
    expect(resolveQuietChromeTargets("custom", overrides)).toEqual(overrides);
  });

  it('returns overrides as the same value for "custom" (no mutation)', () => {
    // Sanity-check: the function shouldn't clone or transform the overrides.
    const result = resolveQuietChromeTargets("custom", overrides);
    expect(result).toEqual(overrides);
  });
});
