// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The Mac app's AND the Share Extension's iCloud entitlements, and the
 * profiles that have to grant them.
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
 *
 * Both bundles are checked by the same cases, because they are separate App
 * IDs with separate profiles and the failure mode of getting only one right is
 * silent. The extension's matters as much as the app's: without it the only
 * route to the library is a user-granted folder bookmark, and a bookmark
 * tracks the FILE — which is how the old grant followed the library into
 * iCloud's Trash and reported every capture as saved (#975).
 */

const ROOT = join(__dirname, "..", "..", "..");
const MACOS = join(ROOT, "src-tauri", "macos");
const CONTAINER = "iCloud.com.notesage.app";

interface Bundle {
  label: string;
  entitlements: string;
  profile: string;
  appId: string;
  /** What the build signs with when no profile is present. */
  preProfile: string;
}

const BUNDLES: Bundle[] = [
  {
    label: "app",
    entitlements: join(MACOS, "App-DeveloperID.entitlements"),
    profile: join(MACOS, "Notesage_macOS_DeveloperID.provisionprofile"),
    appId: "M39TDQ2D7L.com.notesage.app",
    preProfile: join(ROOT, "src-tauri", "Entitlements.plist"),
  },
  {
    label: "Share Extension",
    entitlements: join(MACOS, "ShareExtension-DeveloperID.entitlements"),
    profile: join(MACOS, "Notesage_macOS_ShareExtension_DeveloperID.provisionprofile"),
    appId: "M39TDQ2D7L.com.notesage.app.ShareExtension",
    preProfile: join(MACOS, "ShareExtension.entitlements"),
  },
];

/** The XML plist Apple embeds in the signed profile. */
function profilePlist(profile: string): string {
  const raw = readFileSync(profile, "latin1");
  const start = raw.indexOf("<?xml");
  const end = raw.indexOf("</plist>");
  expect(start, "the profile carries no plist").toBeGreaterThan(-1);
  return raw.slice(start, end + "</plist>".length);
}

/** Keys of an XML plist dict, in file order. */
function keys(xml: string): string[] {
  return [...xml.matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
}

describe.each(BUNDLES)("$label — iCloud entitlements", (bundle: Bundle) => {
  it("ships a provisioning profile to back them", () => {
    // Without this file the release signs with the no-profile entitlements and
    // the bundle silently loses iCloud access — see `build-macos-share-extension.sh`.
    expect(existsSync(bundle.profile), `missing ${bundle.profile}`).toBe(true);
    expect(existsSync(bundle.entitlements), `missing ${bundle.entitlements}`).toBe(true);
  });

  it("claims the same container the iOS app declares", () => {
    // One library every one of them opens. A mismatch here is separate folders
    // and no sync at all.
    const ents = readFileSync(bundle.entitlements, "utf8");
    const ios = readFileSync(join(ROOT, "src-tauri", "ios", "Notesage.entitlements"), "utf8");
    expect(ents).toContain(CONTAINER);
    expect(ios).toContain(CONTAINER);
  });

  it("asks for nothing the profile does not grant", () => {
    // THE invariant. codesign will happily sign an entitlement no profile
    // grants; macOS then declines it at runtime, silently. Every restricted
    // key the bundle claims has to appear in the profile's own grant list.
    const claimed = keys(readFileSync(bundle.entitlements, "utf8")).filter(
      (k) => k.startsWith("com.apple.developer.") || k === "com.apple.application-identifier",
    );
    expect(claimed.length, "no restricted entitlements found to check").toBeGreaterThan(0);

    const granted = profilePlist(bundle.profile);
    for (const key of claimed) {
      expect(granted, `the profile does not grant ${key}`).toContain(key);
    }
  });

  it("is signed as the identity its own profile is for", () => {
    // The app's profile names `com.notesage.app` EXACTLY, not a wildcard, so
    // handing it to the extension would satisfy every other check here and be
    // refused at runtime. Both directions are pinned.
    expect(readFileSync(bundle.entitlements, "utf8")).toContain(bundle.appId);
    expect(profilePlist(bundle.profile)).toContain(bundle.appId);
  });

  it("names the container in the profile's grant, not just in ours", () => {
    expect(profilePlist(bundle.profile)).toContain(CONTAINER);
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
    const raw = readFileSync(bundle.profile, "latin1");
    const certs = (raw.match(/<data>/g) ?? []).length;
    expect(certs, "the profile should carry several certificates").toBeGreaterThan(1);
  });

  it("keeps the pre-profile entitlements free of iCloud", () => {
    // What gets signed before any profile is embedded. An iCloud key there is
    // an entitlement with nothing backing it — at best ignored, at worst a
    // notarisation failure — and it would break the first signing pass rather
    // than the last.
    const plain = readFileSync(bundle.preProfile, "utf8").toLowerCase();
    expect(plain).not.toContain("icloud");
    expect(plain).not.toContain("ubiquity");
  });

  it("is XML strict enough for AMFI, which is stricter than plutil", () => {
    // `--` cannot appear inside an XML comment. `plutil -lint` accepts it;
    // codesign answers "Failed to parse entitlements: AMFIUnserializeXML:
    // syntax error" and the whole signing pass dies. A comment underlined with
    // dashes is the natural way to write one of these files, so this is worth
    // catching before a release does.
    const text = readFileSync(bundle.entitlements, "utf8");
    for (const comment of text.match(/<!--[\s\S]*?-->/g) ?? []) {
      expect(comment.slice(4, -3), "a comment contains '--'").not.toContain("--");
    }
  });
});
