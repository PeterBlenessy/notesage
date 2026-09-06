import { describe, it, expect } from "vitest";
import { inboxDir, inboxMetaDir, recordingsDir } from "@/lib/notes-root";
import { resolveSyncedLibraryRoot, syncedRootLabel } from "@/lib/library-root";
import type { LibraryMarker } from "@/lib/tauri";

const CONTAINER = "/Users/p/Library/Mobile Documents/iCloud~com~notesage~app/Documents";
const CLOUDDOCS = "/Users/p/Library/Mobile Documents/com~apple~CloudDocs/Notesage";

const MIGRATED: LibraryMarker = {
  version: 1,
  kind: "container",
  createdBy: "ios",
  createdAt: "2026-09-05T10:00:00Z",
  migratedFrom: "com~apple~CloudDocs/Notesage",
};

/**
 * The consumers all read ONE setting, `icloudNotesagePath`, and derive their
 * own paths from it. That is what makes moving the library a one-line change
 * for them — and what makes it worth pinning, because a consumer that
 * quietly rebuilt the old path from `getICloudPath()` instead would keep
 * working right up until somebody migrated.
 */
describe("every synced-library consumer follows the resolved root (2026-09-06)", () => {
  it("resolves to the container once a migration is recorded", () => {
    const resolved = resolveSyncedLibraryRoot({
      containerRoot: CONTAINER,
      cloudDocsRoot: CLOUDDOCS,
      marker: MIGRATED,
      cloudDocsHasContent: true,
    });
    expect(resolved).toEqual({ path: CONTAINER, kind: "container" });
  });

  it("puts the Inbox, its sidecar folder and Recordings under that root", () => {
    // Each of these is a plain derivation from the setting. If one of them
    // ever hardcodes iCloud Drive again, this is what catches it.
    expect(inboxDir(CONTAINER)).toBe(`${CONTAINER}/Inbox`);
    expect(inboxMetaDir(CONTAINER)).toContain(CONTAINER);
    expect(recordingsDir(CONTAINER)).toContain(CONTAINER);
    expect(inboxDir(CONTAINER)).not.toContain("com~apple~CloudDocs");
  });

  it("names the root in copy that says where files are going", () => {
    // The sentence sits next to a button that moves a project. Naming the
    // folder the library has already left is worse than naming none.
    expect(syncedRootLabel("container")).toBe("Notesage in iCloud");
    expect(syncedRootLabel("clouddocs")).toContain("iCloud Drive");
    expect(syncedRootLabel(null)).toContain("iCloud Drive");
  });
});
