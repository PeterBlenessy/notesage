import { describe, it, expect } from "vitest";
import {
  libraryMigrationAvailable,
  migrationOfferState,
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

describe("why the migration is or is not offered", () => {
  // A boolean produced the same blank row for four different situations, so
  // somebody who had just turned the flag on could not tell a broken feature
  // from a Mac that is not eligible. Each answer is now nameable.
  const base = {
    containerRoot: "/container",
    cloudDocsRoot: "/clouddocs",
    marker: null,
    cloudDocsHasContent: true,
  };

  it("offers the move when both roots exist and the old one has content", () => {
    expect(migrationOfferState(base)).toBe("offer");
  });

  it("says iCloud is off when there is no CloudDocs root at all", () => {
    expect(migrationOfferState({ ...base, cloudDocsRoot: null })).toBe("no-icloud");
  });

  it("says the container has not arrived when it does not exist", () => {
    // The common case on a second Mac: the folder is made by the iPhone and
    // brought here by iCloud, and this Mac deliberately never creates it.
    expect(migrationOfferState({ ...base, containerRoot: null })).toBe("no-container");
  });

  it("says it is already done when the marker records a migration", () => {
    expect(
      migrationOfferState({
        ...base,
        marker: {
          version: 1,
          kind: "container",
          createdBy: "ios",
          createdAt: "2026-09-01T10:00:00.000Z",
          migratedFrom: "com~apple~CloudDocs/Notesage",
        },
      }),
    ).toBe("already-migrated");
  });

  it("prefers 'already done' over 'nothing to move' for a migrated Mac", () => {
    // A completed migration is WHY the old folder is empty. Reporting that as
    // "there is nothing to move" reads as a fault rather than success.
    expect(
      migrationOfferState({
        ...base,
        cloudDocsHasContent: false,
        marker: {
          version: 1,
          kind: "container",
          createdBy: "macos",
          createdAt: "2026-09-01T10:00:00.000Z",
          migratedFrom: "com~apple~CloudDocs/Notesage",
        },
      }),
    ).toBe("already-migrated");
  });

  it("distinguishes a container it cannot READ from one that is not there", () => {
    // The failure Peter hit: the folder is created by the iPhone and synced
    // down, so it exists on a Mac macOS will not let read it. Reporting that
    // as "no container" would send somebody to wait for a folder already
    // sitting on their disk; the remedy is Full Disk Access, not patience.
    expect(migrationOfferState({ ...base, containerAccess: "denied" })).toBe("container-denied");
    expect(migrationOfferState({ ...base, containerAccess: "ready" })).toBe("offer");
  });

  it("treats an unasked access question as readable", () => {
    // `resolveSyncedLibraryRoot` shares these inputs and has no reason to
    // probe; only the migration offer does.
    expect(migrationOfferState(base)).toBe("offer");
  });

  it("answers the access question before anything that needs to read", () => {
    // A denial breaks the marker read too, so a denied container with no
    // readable marker must not come back as "not migrated yet".
    expect(
      migrationOfferState({ ...base, containerAccess: "denied", cloudDocsHasContent: false }),
    ).toBe("container-denied");
  });

  it("says there is nothing to move when the old folder is empty", () => {
    expect(migrationOfferState({ ...base, cloudDocsHasContent: false })).toBe("nothing-to-move");
  });
});
