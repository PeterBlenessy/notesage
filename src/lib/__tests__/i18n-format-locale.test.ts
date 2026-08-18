// @vitest-environment jsdom
/**
 * The formatting locale (#705, phase 1).
 *
 * `t()` translates UI strings; this is the other half — dates and numbers that
 * `Intl` formats. The two must follow the SAME choice, or a user who picks
 * Svenska gets Swedish labels next to `8/18/2026`.
 *
 * The distinction that matters here is "follow the OS" vs "an explicit
 * choice". With no override we must pass `undefined` to `Intl` rather than a
 * narrowed `"sv"`, so a Finnish-Swedish user keeps `sv-FI` conventions instead
 * of being flattened to Sweden's. Narrowing is only correct once the user has
 * actually asked for a specific language.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { setLocale, getLocale, getFormatLocale, subscribeLocale } from "@/lib/i18n";

describe("getFormatLocale", () => {
  beforeEach(() => {
    setLocale(null);
  });

  it("returns undefined with no override, so Intl follows the OS", () => {
    // Not "en" — undefined lets Intl use the full platform locale (sv-FI,
    // en-GB) rather than the base language we narrowed it to.
    expect(getFormatLocale()).toBeUndefined();
  });

  it("returns the chosen language once the user picks one", () => {
    setLocale("sv");
    expect(getFormatLocale()).toBe("sv");
  });

  it("returns to OS-following when the override is cleared", () => {
    setLocale("sv");
    setLocale(null);
    expect(getFormatLocale()).toBeUndefined();
  });

  it("formats dates in the chosen language", () => {
    setLocale("sv");
    const d = new Date(Date.UTC(2026, 7, 18));
    const sv = d.toLocaleDateString(getFormatLocale(), { month: "long", timeZone: "UTC" });
    expect(sv.toLowerCase()).toContain("augusti");
  });

  it("formats numbers in the chosen language", () => {
    setLocale("sv");
    // Swedish groups with a space and uses a decimal comma.
    const out = new Intl.NumberFormat(getFormatLocale()).format(1234.5);
    expect(out).not.toBe("1,234.5");
    expect(out).toContain(",");
  });
});

describe("locale change notification", () => {
  beforeEach(() => {
    setLocale(null);
  });

  it("notifies subscribers when only the format locale changes", () => {
    // The trap: with an English OS, choosing "English" leaves the resolved
    // locale at "en" — unchanged — while the format locale goes undefined →
    // "en". Comparing only the resolved locale would skip the notification and
    // leave every rendered date stale until something else re-rendered.
    let calls = 0;
    const unsub = subscribeLocale(() => { calls += 1; });

    const platform = getLocale();
    setLocale(platform); // same resolved language, but now an explicit choice

    expect(getFormatLocale()).toBe(platform);
    expect(calls).toBe(1);
    unsub();
  });

  it("does not notify when nothing actually changed", () => {
    setLocale("sv");
    let calls = 0;
    const unsub = subscribeLocale(() => { calls += 1; });
    setLocale("sv");
    expect(calls).toBe(0);
    unsub();
  });
});
