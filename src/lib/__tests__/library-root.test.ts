import { describe, it, expect } from "vitest";
import {
  libraryMigrationAvailable,
  resolveSyncedLibraryRoot,
  type LibraryRootInputs,
} from "@/lib/library-root";
import type { LibraryMarker } from "@/lib/tauri";

const CONTAINER = "/Users/p/Library/Mobile Documents/iCloud~com~notesage~app/Documents";
const CLOUDDOCS = "/Users/p/Library/Mobile Documents/com~apple~CloudDocs/Notesage";

function marker(over: Partial<LibraryMarker> = {}): LibraryMarker {
  return {
    version: 1,
    kind: "container",
    createdBy: "ios",
    createdAt: "2026-09-05T10:00:00Z",
    ...over,
  };
}

function inputs(over: Partial<LibraryRootInputs> = {}): LibraryRootInputs {
  return {
    containerRoot: null,
    cloudDocsRoot: null,
    marker: null,
    cloudDocsHasContent: false,
    ...over,
  };
}

describe("which synced library is the live one (2026-09-06)", () => {
  it("follows a migration recorded in the marker, even with the old folder still full", () => {
    // The case the marker exists for: both directories are there and full,
    // and only the marker says which one people are actually using now.
    const r = resolveSyncedLibraryRoot(
      inputs({
        containerRoot: CONTAINER,
        cloudDocsRoot: CLOUDDOCS,
        cloudDocsHasContent: true,
        marker: marker({ migratedFrom: "com~apple~CloudDocs/Notesage" }),
      }),
    );
    expect(r).toEqual({ path: CONTAINER, kind: "container" });
  });

  it("joins a phone-made library when there is nothing in the old place", () => {
    const r = resolveSyncedLibraryRoot(
      inputs({ containerRoot: CONTAINER, cloudDocsRoot: CLOUDDOCS, marker: marker() }),
    );
    expect(r).toEqual({ path: CONTAINER, kind: "container" });
  });

  it("leaves today's library alone when it still holds the content", () => {
    // Every current user takes this branch, and must keep taking it until a
    // migration is actually performed. A marked container is not enough.
    const r = resolveSyncedLibraryRoot(
      inputs({
        containerRoot: CONTAINER,
        cloudDocsRoot: CLOUDDOCS,
        cloudDocsHasContent: true,
        marker: marker(),
      }),
    );
    expect(r).toEqual({ path: CLOUDDOCS, kind: "clouddocs" });
  });

  it("uses the container when there is no CloudDocs library at all", () => {
    const r = resolveSyncedLibraryRoot(inputs({ containerRoot: CONTAINER }));
    expect(r).toEqual({ path: CONTAINER, kind: "container" });
  });

  it("still points at CloudDocs when iCloud is on but nothing exists yet", () => {
    // A first run with sync enabled: the folder is where the library WILL be.
    const r = resolveSyncedLibraryRoot(inputs({ cloudDocsRoot: CLOUDDOCS }));
    expect(r).toEqual({ path: CLOUDDOCS, kind: "clouddocs" });
  });

  it("resolves to nothing when iCloud is off and no container exists", () => {
    expect(resolveSyncedLibraryRoot(inputs())).toEqual({ path: null, kind: null });
  });

  it("does not count a lone .DS_Store as content", () => {
    // Finder drops one into any folder a person opens. Treating that as "a
    // library lives here" would strand a phone-first user on an empty root.
    const r = resolveSyncedLibraryRoot(
      inputs({
        containerRoot: CONTAINER,
        cloudDocsRoot: CLOUDDOCS,
        marker: marker(),
        cloudDocsHasContent: false, // the caller has already excluded .DS_Store
      }),
    );
    expect(r.kind).toBe("container");
  });
});

describe("when to offer the migration", () => {
  it("offers it only when there is something to move and no migration yet", () => {
    expect(
      libraryMigrationAvailable(
        inputs({
          containerRoot: CONTAINER,
          cloudDocsRoot: CLOUDDOCS,
          cloudDocsHasContent: true,
          marker: marker(),
        }),
      ),
    ).toBe(true);
  });

  it("does not offer it twice", () => {
    expect(
      libraryMigrationAvailable(
        inputs({
          containerRoot: CONTAINER,
          cloudDocsRoot: CLOUDDOCS,
          cloudDocsHasContent: true,
          marker: marker({ migratedFrom: "com~apple~CloudDocs/Notesage" }),
        }),
      ),
    ).toBe(false);
  });

  it("does not offer it with nothing to move, or with no container to move into", () => {
    expect(
      libraryMigrationAvailable(
        inputs({ containerRoot: CONTAINER, cloudDocsRoot: CLOUDDOCS, marker: marker() }),
      ),
    ).toBe(false);
    expect(
      libraryMigrationAvailable(inputs({ cloudDocsRoot: CLOUDDOCS, cloudDocsHasContent: true })),
    ).toBe(false);
  });
});
