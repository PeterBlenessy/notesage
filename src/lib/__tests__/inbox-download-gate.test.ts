// @vitest-environment node
/**
 * The Inbox badge's sidecar read must stay gated on the DOWNLOAD STATUS.
 *
 * This exact read has been wrong twice, both times with the same user-visible
 * result: the badge frozen at the Inbox's file count for ever, because reading
 * an article writes a sidecar the counter cannot open, so every item keeps
 * counting as unread.
 *
 *   1. a plain `Data(contentsOf:)`, which cannot see an evicted iCloud file;
 *   2. an existence check, which cannot see one either — since iOS 11 an
 *      evicted item keeps its real name in the directory listing and hides
 *      the `.name.icloud` placeholder, so `fileExists` answers true for a
 *      file with nothing behind it.
 *
 * A third regression to existence-only would be caught by nothing: the
 * behavioural harness (`scripts/check-inbox-state.sh`) cannot reach this
 * branch, because creating an evicted placeholder needs a real ubiquity
 * container. So the gate is locked here by its source shape, the same
 * technique `inbox-unread-rule.test.ts` uses for the rule beside it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const swift = readFileSync(
  resolve(ROOT, "src-tauri/crates/tauri-plugin-notesage-ios/ios/Sources/InboxState.swift"),
  "utf8",
);

/** The body of `progressItems`, where the whole gate lives. */
const gate = swift.slice(
  swift.indexOf("static func progressItems"),
  swift.indexOf("static func didWriteCapture"),
);

describe("the Inbox badge's sidecar read", () => {
  it("asks the downloading status, not just whether the path exists", () => {
    expect(gate).toContain("ubiquitousItemDownloadingStatusKey");
    // `.current` is the only status meaning the bytes are here: `.downloaded`
    // means stale, `.notDownloaded` that there are none.
    expect(gate).toContain(".current");
  });

  it("requests the download before reading", () => {
    expect(gate).toContain("startDownloadingUbiquitousItem");
    // Match the CALL, not the prose: the comment above it names
    // `Data(contentsOf:)` while explaining the bug, and the first version of
    // this assertion compared against that occurrence instead.
    expect(gate.indexOf("try? fm.startDownloadingUbiquitousItem")).toBeLessThan(
      gate.indexOf("data = try? Data(contentsOf: u)"),
    );
  });

  it("reads through NSFileCoordinator, catching up with the app's own writes", () => {
    expect(gate).toContain("NSFileCoordinator().coordinate(readingItemAt:");
  });

  it("treats an unanswerable status as 'may be missing' rather than 'fine'", () => {
    // `resourceValues` THROWS under I/O contention rather than returning a nil
    // status. `try?` folded that into the same nil as "not an iCloud file",
    // which skipped the download and reverted this read to the pre-fix
    // behaviour for that call. A download request for a file already present
    // is a no-op; skipping it on a placeholder is the bug.
    expect(gate).toContain("catch {");
    const catchBody = gate.slice(gate.indexOf("catch {"));
    expect(catchBody.slice(0, catchBody.indexOf("}"))).toContain("needsDownload = true");
    expect(gate).not.toContain("try? url.resourceValues");
  });

  it("still treats a non-ubiquitous file as an existence question", () => {
    // A file that is not in iCloud reports no status at all, and then
    // existence really was the whole question — a nil status must not be read
    // as "needs downloading", or every local library would request downloads
    // for files that are simply there.
    expect(gate).toContain("status != nil && status != .current");
  });

  it("falls back to empty rather than throwing, matching the TS parser", () => {
    // `parseReadingProgress` tolerates a missing or malformed sidecar; a
    // native crash here would take out the background refresh instead.
    expect(gate).toContain("else { return [:] }");
  });
});
