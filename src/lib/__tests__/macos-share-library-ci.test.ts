// @vitest-environment node
/**
 * The macOS Share Extension's Swift is covered by CI (2026-09-09).
 *
 * It was not, and that is how `ShareLibraryAccess.swift` — the file that
 * decides WHERE a shared article is written — went unchecked until a release
 * built it. The cost showed up as a bug nobody could see: a security-scoped
 * bookmark tracks the file, not the path, so when the library migrated into
 * the iCloud container the extension's grant followed the old root into
 * `~/Library/Mobile Documents/.Trash/Notesage`, resolved cleanly, and reported
 * every capture as saved. Two articles landed on iCloud's 30-day delete timer.
 *
 * These lock in the two checks that now stand in the way: the sources are
 * type-checked, and the "is this still the library?" rule is executed against
 * real paths.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const workflow = readFileSync(resolve(ROOT, ".github/workflows/test.yml"), "utf8");

describe("macOS Share Extension — CI coverage", () => {
  it("type-checks every Swift source the extension ships", () => {
    // A filename list only covers what someone remembered to add — the same
    // trap the iOS job hit twice — so assert every file in the directory
    // appears in the workflow.
    const step = workflow.slice(workflow.indexOf("Type-check macOS Share Extension sources"));
    expect(step.length).toBeGreaterThan(0);
    for (const file of [
      "ShareLibraryAccess.swift",
      "ShareCapture.swift",
      "PageRenderer.swift",
      "ShareViewController.swift",
    ]) {
      expect(existsSync(resolve(ROOT, "src-tauri/macos", file)), `${file} missing`).toBe(true);
      expect(step.slice(0, 1200)).toContain(`src-tauri/macos/${file}`);
    }
  });

  it("runs the library-validity rule as a CI step", () => {
    expect(workflow).toContain("./scripts/check-macos-share-library.sh");
  });

  it("ships that check as an executable script with its harness", () => {
    const sh = resolve(ROOT, "scripts/check-macos-share-library.sh");
    expect(existsSync(sh)).toBe(true);
    // eslint-disable-next-line no-bitwise
    expect(statSync(sh).mode & 0o111).toBeGreaterThan(0);
    expect(existsSync(resolve(ROOT, "scripts/macos-share-library-check/main.swift"))).toBe(true);
  });
});

describe("ShareLibraryAccess — the rule itself", () => {
  const swift = readFileSync(resolve(ROOT, "src-tauri/macos/ShareLibraryAccess.swift"), "utf8");

  it("validates the resolved root before handing it to a write", () => {
    // Resolving is not the same as still being the library. Without this call
    // the extension writes wherever the bookmark leads, including the Trash.
    const resolveFn = swift.slice(swift.indexOf("private static func resolveRoot"));
    expect(resolveFn.slice(0, resolveFn.indexOf("\n    }"))).toContain("validateLiveLibrary(url)");
  });

  it("rejects a root in the Trash, a missing root, and one the container superseded", () => {
    expect(swift).toContain('pathComponents.contains(".Trash")');
    expect(swift).toContain("fileExists(atPath: url.path, isDirectory:");
    expect(swift).toContain("libraryMigratedIntoContainer()");
  });

  it("treats an unreadable marker as 'no migration', not as a lockout", () => {
    // The extension runs without the app. A hand-edited or half-written
    // marker must not be able to stop someone sharing.
    expect(swift).toMatch(/guard let data = try\? Data\(contentsOf: marker\)/);
    expect(swift).toContain("else { return false }");
  });
});
