import { describe, expect, it } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { SUPPORTED_LOCALES } from "../i18n";

/**
 * The iOS permission prompts are localised, and stay in step (#990).
 *
 * A usage description is the sentence that decides whether someone grants a
 * permission, and iOS reads it from the BUNDLE — before any JavaScript has
 * run, so the app's own `t()` tables are invisible to it. A Swedish phone
 * showed a Swedish title over an English explanation until `.lproj` files
 * existed for the app target.
 *
 * That leaves the same sentence in three places with nothing binding them:
 * the English `.lproj`, the value `integrate-share-extension.py` writes into
 * the generated Info.plist (the fallback for every language with no `.lproj`),
 * and `src-tauri/Info.plist` (macOS). Edit one and a device in a third
 * language consents to different words from an English one, with nothing
 * failing. So they are pinned here.
 */
const REPO = resolve(__dirname, "../../..");
const APP_RESOURCES = resolve(REPO, "src-tauri/ios/AppResources");

/** `"KEY" = "value";` — the .strings format, comments stripped. */
function parseStrings(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/"([^"]+)"\s*=\s*"((?:[^"\\]|\\.)*)"\s*;/g)) {
    out[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return out;
}

/**
 * Derived, not listed. A hardcoded key set passes happily the day someone adds
 * `NSCameraUsageDescription` to the integrator — shipping the exact
 * English-only prompt #990 fixed, with all four of these tests green.
 */
const REQUIRED_KEYS = (() => {
  const integrator = readFileSync(
    resolve(REPO, "src-tauri/ios/integrate-share-extension.py"),
    "utf8",
  );
  // ASSIGNMENTS only — `app_info["NS…UsageDescription"] = …`. Matching every
  // mention would let a comment ("we deliberately do not request
  // NSCameraUsageDescription") demand a string nothing declares.
  const declared = [...integrator.matchAll(/app_info\[["'](NS\w+UsageDescription)["']\]\s*=/g)].map(
    (m) => m[1],
  );
  // Union with whatever the English bundle already carries, so a key that
  // reaches the Info.plist by another route — Tauri's own plist merge, a hand
  // edit — is still required in every language rather than silently exempt.
  const inBundle = Object.keys(parseStrings(resolve(APP_RESOURCES, "en.lproj/InfoPlist.strings")));
  return [...new Set([...declared, ...inBundle])];
})();

describe("iOS usage descriptions", () => {
  it("has an InfoPlist.strings for every language the app speaks", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const path = resolve(APP_RESOURCES, `${locale}.lproj/InfoPlist.strings`);
      expect(
        existsSync(path),
        `${locale} is in SUPPORTED_LOCALES but has no ${locale}.lproj/InfoPlist.strings — ` +
          `iOS would show that language a permission prompt in English`,
      ).toBe(true);
    }
  });

  it("translates every required key in every language", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const strings = parseStrings(resolve(APP_RESOURCES, `${locale}.lproj/InfoPlist.strings`));
      for (const key of REQUIRED_KEYS) {
        expect(strings[key], `${key} missing from ${locale}.lproj`).toBeTruthy();
      }
    }
  });

  it("keeps the English text identical to the fallback the build writes", () => {
    // Not style: this English string is what a device in a language with no
    // .lproj is shown, so a drift between them means two users consent to
    // different sentences.
    const english = parseStrings(resolve(APP_RESOURCES, "en.lproj/InfoPlist.strings"));
    const integrator = readFileSync(
      resolve(REPO, "src-tauri/ios/integrate-share-extension.py"),
      "utf8",
    );
    const macPlist = readFileSync(resolve(REPO, "src-tauri/Info.plist"), "utf8");

    for (const key of REQUIRED_KEYS) {
      const text = english[key];
      expect(
        integrator.includes(text),
        `${key} in en.lproj does not match the value integrate-share-extension.py writes`,
      ).toBe(true);
      expect(
        macPlist.includes(text),
        `${key} in en.lproj does not match src-tauri/Info.plist`,
      ).toBe(true);
    }
  });

  it("declares no language the app does not speak", () => {
    // The reverse drift. Checked against what is actually on disk rather than
    // against a guessed list of languages we do not have: the integrator now
    // globs `*.lproj`, so any directory added here is shipped and declared to
    // App Store Connect, whether or not the UI can render that language.
    const present = readdirSync(APP_RESOURCES)
      .filter((name) => name.endsWith(".lproj"))
      .map((name) => name.replace(/\.lproj$/, ""));
    expect(present.length).toBeGreaterThan(0);
    for (const locale of present) {
      expect(
        (SUPPORTED_LOCALES as readonly string[]).includes(locale),
        `${locale}.lproj would ship and declare a language the app does not speak`,
      ).toBe(true);
    }
  });
});
