// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The Mac app's iCloud entitlement, and the profile that has to grant it.
 *
 * `~/Library/Mobile Documents/iCloud~com~notesage~app` is a TCC-protected
 * container macOS opens only to an app that can prove it owns it. The proof is
 * an entitlement backed by an embedded provisioning profile. Get the pair
 * wrong and nothing fails at build time: the app signs, notarises, launches,
 * and then cannot read the user's library — which is the bug this whole file
 * exists to stop recurring (v0.57.1, "Operation not permitted (os error 1)",
 * whose only workaround was granting Full Disk Access).
 *
 * The profile is parsed by pulling the plain-text plist out of the CMS blob,
 * rather than shelling out to `security cms -D`, so this runs on the Linux
 * box CI uses for the frontend job as well as on a Mac.
 */

const ROOT = join(__dirname, "..", "..", "..");
const MACOS = join(ROOT, "src-tauri", "macos");
const ENTITLEMENTS = join(MACOS, "App-DeveloperID.entitlements");
const PROFILE = join(MACOS, "Notesage_macOS_DeveloperID.provisionprofile");
const CONTAINER = "iCloud.com.notesage.app";

/** The XML plist Apple embeds in the signed profile. */
function profilePlist(): string {
  const raw = readFileSync(PROFILE, "latin1");
  const start = raw.indexOf("<?xml");
  const end = raw.indexOf("</plist>");
  expect(start, "the profile carries no plist").toBeGreaterThan(-1);
  return raw.slice(start, end + "</plist>".length);
}

/** Keys of an XML plist dict, in file order. */
function keys(xml: string): string[] {
  return [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
}

describe("the Mac app's iCloud entitlements", () => {
  it("ships a provisioning profile to back them", () => {
    // Without this file the release signs with the no-profile entitlements and
    // the app silently loses iCloud access — see `build-macos-share-extension.sh`.
    expect(existsSync(PROFILE), `missing ${PROFILE}`).toBe(true);
    expect(existsSync(ENTITLEMENTS), `missing ${ENTITLEMENTS}`).toBe(true);
  });

  it("claims the same container the iOS app declares", () => {
    // One library both apps open. A mismatch here is two apps politely using
    // separate folders and no sync at all.
    const ents = readFileSync(ENTITLEMENTS, "utf8");
    const ios = readFileSync(join(ROOT, "src-tauri", "ios", "Notesage.entitlements"), "utf8");
    expect(ents).toContain(CONTAINER);
    expect(ios).toContain(CONTAINER);
  });

  it("asks for nothing the profile does not grant", () => {
    // THE invariant. codesign will happily sign an entitlement no profile
    // grants; macOS then declines it at runtime, silently. Every restricted
    // key the app claims has to appear in the profile's own grant list.
    const claimed = keys(readFileSync(ENTITLEMENTS, "utf8")).filter(
      (k) => k.startsWith("com.apple.developer.") || k === "com.apple.application-identifier",
    );
    expect(claimed.length, "no restricted entitlements found to check").toBeGreaterThan(0);

    const granted = profilePlist();
    for (const key of claimed) {
      expect(granted, `the profile does not grant ${key}`).toContain(key);
    }
  });

  it("names the container in the profile's grant, not just in ours", () => {
    expect(profilePlist()).toContain(CONTAINER);
  });

  it("covers every Developer ID certificate, not just one", () => {
    // v0.57.2 shipped a profile built against ONE certificate — the newest by
    // expiry — while CI signs with a different one. macOS refuses entitlements
    // whose profile does not cover the signing certificate and kills the
    // process at exec, so the app simply would not open. The signature was
    // valid, notarised and Gatekeeper-approved throughout; only the pairing
    // was wrong.
    //
    // A profile covering every Developer ID certificate cannot be wrong about
    // which one CI used, and survives a rotation. This asserts the count
    // rather than the identities: certificates come and go, "more than one" is
    // the property that stops the mistake recurring.
    const raw = readFileSync(PROFILE, "latin1");
    const certs = (raw.match(/<data>/g) ?? []).length;
    expect(certs, "the profile should carry several certificates").toBeGreaterThan(1);
  });

  it("keeps the pre-profile entitlements free of iCloud", () => {
    // `Entitlements.plist` is what `tauri-bundler` signs with, before any
    // profile is embedded. An iCloud key there is an entitlement with nothing
    // backing it — at best ignored, at worst a notarisation failure — and it
    // would break the first signing pass rather than the last.
    const plain = readFileSync(join(ROOT, "src-tauri", "Entitlements.plist"), "utf8");
    expect(plain).not.toContain("icloud");
    expect(plain).not.toContain("ubiquity");
  });
});
