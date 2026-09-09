// @vitest-environment node
/**
 * Privacy manifests for the iOS app and its Share Extension.
 *
 * Required since 2024-05-01: an app using a "required reason" API without
 * declaring it is not accepted by App Store Connect. The trap is the failure
 * mode — before submission Apple only emails an ITMS-91053 warning, so a
 * missing manifest looks exactly like a working one for as long as you use
 * only TestFlight. This repo had none at all.
 *
 * These tests do two things a lint cannot: they check the manifests exist and
 * are wired into BOTH bundles, and they tie each declared category to the code
 * that actually calls the API — so adding a required-reason API without
 * declaring it, or declaring one nothing uses, fails here.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const APP = join(ROOT, "src-tauri/ios/privacy/app/PrivacyInfo.xcprivacy");
const SHARE = join(ROOT, "src-tauri/ios/privacy/share/PrivacyInfo.xcprivacy");
const INTEGRATE = join(ROOT, "src-tauri/ios/integrate-share-extension.py");

/** Category → reason codes, straight out of the plist XML. */
function declared(path: string): Record<string, string[]> {
  const xml = readFileSync(path, "utf8");
  const out: Record<string, string[]> = {};
  const blocks = xml.split("<key>NSPrivacyAccessedAPIType</key>").slice(1);
  for (const block of blocks) {
    const category = block.match(/<string>(NSPrivacyAccessedAPICategory\w+)<\/string>/)?.[1];
    const reasonsXml = block.split("NSPrivacyAccessedAPITypeReasons")[1]?.split("</array>")[0] ?? "";
    if (category) out[category] = [...reasonsXml.matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1]);
  }
  return out;
}

/** Every Swift file the extension target compiles, per the integration script. */
function shareSources(): string[] {
  const py = readFileSync(INTEGRATE, "utf8");
  const target = py.slice(py.indexOf("SHARE_TARGET = {"), py.indexOf("# NO \"info\" key"));
  return [...target.matchAll(/"path": "\.\.\/\.\.\/([^"]+\.swift)"/g)].map((m) => m[1]);
}

function swiftText(paths: string[]): string {
  return paths
    .map((p) => {
      const full = join(ROOT, "src-tauri", p);
      return existsSync(full) ? readFileSync(full, "utf8") : "";
    })
    .join("\n");
}

/** Every Swift source that ships in the APP (the plugin's sources + ios/). */
function appSwiftText(): string {
  const dirs = [
    join(ROOT, "src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources"),
    join(ROOT, "src-tauri/ios"),
  ];
  return dirs
    .flatMap((d) =>
      existsSync(d)
        ? readdirSync(d).filter((f) => f.endsWith(".swift")).map((f) => readFileSync(join(d, f), "utf8"))
        : [],
    )
    .join("\n");
}

describe("iOS privacy manifests", () => {
  it("exist for both bundles", () => {
    // One per BUNDLE containing an executable that uses the APIs — an .appex
    // is its own bundle and cannot rely on the app's.
    expect(existsSync(APP), `missing ${APP}`).toBe(true);
    expect(existsSync(SHARE), `missing ${SHARE}`).toBe(true);
  });

  it("are named PrivacyInfo.xcprivacy, which is how Apple finds them", () => {
    // Xcode copies resources without renaming, so the filename on disk is the
    // filename in the bundle. Two files in one directory could not both be
    // right, which is why these live in separate directories.
    expect(APP.endsWith("/PrivacyInfo.xcprivacy")).toBe(true);
    expect(SHARE.endsWith("/PrivacyInfo.xcprivacy")).toBe(true);
    expect(APP).not.toBe(SHARE);
  });

  it("are copied into both targets by the integration script", () => {
    // `tauri ios init` regenerates project.yml, so anything not re-applied by
    // this script is silently dropped on the next CI run.
    const py = readFileSync(INTEGRATE, "utf8");
    expect(py).toContain("ios/privacy/share/PrivacyInfo.xcprivacy");
    expect(py).toContain("ios/privacy/app/PrivacyInfo.xcprivacy");
  });

  it("declare no tracking and no collection, matching the App Privacy answers", () => {
    for (const path of [APP, SHARE]) {
      const xml = readFileSync(path, "utf8");
      expect(xml).toMatch(/<key>NSPrivacyTracking<\/key>\s*<false\/>/);
      expect(xml).toMatch(/<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
      expect(xml).toMatch(/<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
    }
  });

  it("declare every category the code actually reaches for", () => {
    const app = declared(APP);
    // File timestamps: LibraryAccess reads contentModificationDate for the
    // listing, and the reader displays it.
    expect(appSwiftText()).toContain("contentModificationDateKey");
    expect(app.NSPrivacyAccessedAPICategoryFileTimestamp).toEqual(
      expect.arrayContaining(["3B52.1", "C617.1"]),
    );
    // Disk space: the recorder refuses to start under 200 MB free.
    expect(appSwiftText()).toContain("volumeAvailableCapacityForImportantUsage");
    expect(app.NSPrivacyAccessedAPICategoryDiskSpace).toEqual(["E174.1"]);
    // Defaults: every iOS access goes through the App Group suite, which is
    // 1C8F.1 — CA92.1 would be wrong, as it excludes anything another
    // extension can read.
    expect(appSwiftText()).toContain("UserDefaults(suiteName:");
    expect(app.NSPrivacyAccessedAPICategoryUserDefaults).toEqual(["1C8F.1"]);
  });

  it("does not have the extension claim disk space it never checks", () => {
    // The extension declares LESS than the app because it does less: Recorder
    // is not one of its sources. An over-declaration is a claim about
    // behaviour that isn't there.
    const share = declared(SHARE);
    expect(shareSources().length).toBeGreaterThan(0);
    expect(swiftText(shareSources())).not.toContain("volumeAvailableCapacity");
    expect(share.NSPrivacyAccessedAPICategoryDiskSpace).toBeUndefined();
    expect(Object.keys(share).sort()).toEqual([
      "NSPrivacyAccessedAPICategoryFileTimestamp",
      "NSPrivacyAccessedAPICategoryUserDefaults",
    ]);
  });

  it("uses only reason codes Apple recognises for each category", () => {
    // A code outside the category's list is ITMS-91055 ("Invalid API reason
    // declaration") — a rejection, not a warning. Sourced from Apple's
    // NSPrivacyAccessedAPIType documentation.
    const allowed: Record<string, string[]> = {
      NSPrivacyAccessedAPICategoryFileTimestamp: ["DDA9.1", "C617.1", "3B52.1", "0A2A.1"],
      NSPrivacyAccessedAPICategoryDiskSpace: ["85F4.1", "E174.1", "7D9E.1", "B728.1"],
      NSPrivacyAccessedAPICategoryUserDefaults: ["CA92.1", "1C8F.1", "C56D.1", "AC6B.1"],
      NSPrivacyAccessedAPICategorySystemBootTime: ["35F9.1", "8FFB.1", "3D61.1"],
    };
    for (const path of [APP, SHARE]) {
      for (const [category, reasons] of Object.entries(declared(path))) {
        expect(allowed[category], `unknown category ${category}`).toBeDefined();
        expect(reasons.length, `${category} declares no reason`).toBeGreaterThan(0);
        for (const r of reasons) {
          expect(allowed[category], `${r} is not valid for ${category}`).toContain(r);
        }
      }
    }
  });

  it("keeps its XML strict enough for Apple's parser", () => {
    // Same trap as the entitlements files: `--` cannot appear inside an XML
    // comment, and `plutil -lint` accepts it anyway.
    for (const path of [APP, SHARE]) {
      const text = readFileSync(path, "utf8");
      for (const comment of text.match(/<!--[\s\S]*?-->/g) ?? []) {
        expect(comment.slice(4, -3), `${path}: a comment contains '--'`).not.toContain("--");
      }
    }
  });
});
