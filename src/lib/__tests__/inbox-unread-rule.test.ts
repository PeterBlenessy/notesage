import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The phone's icon badge is computed natively (`InboxState.swift`, compiled
 * into the app, the background refresh and the Share Extension) with the
 * same unread rule the frontend and the Mac use (`isUnread` in
 * reading-progress-file.ts). There is no Swift test harness in this repo, so
 * this locks the two together by their source: a change to either must
 * change the other, and this test names it.
 */
const ROOT = resolve(__dirname, "../../..");
const swift = readFileSync(
  resolve(ROOT, "src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift"),
  "utf8",
);
const ts = readFileSync(resolve(ROOT, "src/lib/reading-progress-file.ts"), "utf8");

describe("the unread rule is one rule on both sides", () => {
  it("both check exactly: absent entry, deleted tombstone, openedAt null", () => {
    const tsRule = ts.slice(ts.indexOf("export function isUnread"), ts.indexOf("export function isFinished"));
    expect(tsRule).toContain("!entry");
    expect(tsRule).toContain("entry.deleted === true");
    expect(tsRule).toContain("entry.openedAt === null");
    const swiftRule = swift.slice(swift.indexOf("static func isUnread"), swift.indexOf("static func progressItems"));
    expect(swiftRule).toContain("guard let entry else { return true }");
    expect(swiftRule).toContain('entry["deleted"] as? Bool == true');
    expect(swiftRule).toContain('entry["openedAt"]');
    expect(swiftRule).toContain("is NSNull");
    // Nothing else in the sidecar is interpreted by either side's rule.
    for (const field of ["fraction", "resetAt", "updatedAt", "speech"]) {
      expect(swiftRule).not.toContain(field);
      expect(tsRule).not.toContain(field);
    }
  });

  it("reads the same sidecar the frontend writes", () => {
    expect(swift).toContain('static let sidecarRel = "Inbox/.notesage/reading-progress.json"');
    expect(ts).toContain("reading-progress.json");
  });
});

describe("the badge counter can read a synced sidecar (2026-09-05)", () => {
  const swift = readFileSync(
    resolve(__dirname, "../../../src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift"),
    "utf8",
  );

  it("reads the sidecar through a file coordinator, not a bare Data(contentsOf:)", () => {
    // In an iCloud library the sidecar can be an evicted placeholder, and an
    // uncoordinated read of one fails in a way this file cannot tell apart
    // from "nothing has ever been read". Every item then counts unread, so
    // the badge equals the Inbox's file count and never moves again.
    const body = swift.slice(swift.indexOf("static func progressItems"));
    const fn = body.slice(0, body.indexOf("\n    }"));
    expect(fn).toContain("NSFileCoordinator()");
    expect(fn).toContain("startDownloadingUbiquitousItem");
  });
});
