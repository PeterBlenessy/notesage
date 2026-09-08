// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import {
  buildMigrationListing,
  collectSidecarFilePaths,
  mergePinsFiles,
  migrationDeps,
  clearMigrationInMarker,
  recordMigrationInMarker,
} from "@/lib/library-migration-run";
import {
  LEGACY_CLOUD_DOCS_LIBRARY,
  markMigrated,
  newLibraryMarker,
  type LibraryMarker,
} from "@/lib/library-marker";

/**
 * The wiring between the pure migration and the real filesystem.
 *
 * These exist because the pure tests mock `listNames` and `listDirectory`
 * with hand-picked arrays, which is exactly how a missing `showHidden`
 * argument stayed invisible: every unit test passed while the real call
 * silently skipped `.notesage/` and stranded a project's comments.
 */
describe("library migration wiring (2026-09-06)", () => {
  let listed: { relPath: string; showHidden: unknown }[];

  beforeEach(() => {
    listed = [];
    setMockInvokeHandler("list_directory", (args) => {
      const a = args as { path: string; showHidden?: boolean };
      listed.push({ relPath: a.path, showHidden: a.showHidden });
      return [
        { name: "note.md", path: `${a.path}/note.md`, is_directory: false, hidden: false },
        { name: ".notesage", path: `${a.path}/.notesage`, is_directory: true, hidden: true },
      ];
    });
    // Project detection now asks rather than assuming: a failed check used to
    // demote a project to a plain folder, and same-named plain folders MERGE.
    setMockInvokeHandler("path_exists", () => false);
  });

  it("lists a folder's children INCLUDING hidden ones when merging", async () => {
    // `.notesage/` carries a project's comments, pins, settings and any AI
    // lock. A merge that cannot see it moves every document out and leaves
    // that behind — while reporting success, which is worse than the loud
    // failure it replaced.
    const names = await migrationDeps().listNames("/old/Notes");
    expect(listed[0].showHidden).toBe(true);
    expect(names).toContain(".notesage");
  });

  it("reads both roots with hidden entries, so an evicted file is visible", async () => {
    // An evicted iCloud file exists on disk only as `.name.icloud`. Hidden
    // from the listing, it is never planned, never moved and never reported.
    await buildMigrationListing("/old");
    expect(listed.every((l) => l.showHidden === true)).toBe(true);
  });
});

describe("merging the pins file", () => {
  it("unions both sides and survives a malformed one", () => {
    // Losing a pin is a nuisance; failing a library migration over one is
    // not a trade worth making.
    expect(JSON.parse(mergePinsFiles('{"pins":["a"]}', '{"pins":["b","a"]}')).pins).toEqual([
      "a",
      "b",
    ]);
    expect(JSON.parse(mergePinsFiles("not json", '{"pins":["b"]}')).pins).toEqual(["b"]);
    expect(JSON.parse(mergePinsFiles(null, null)).pins).toEqual([]);
  });
});

describe("recording the migration in the marker (2026-09-06)", () => {
  const deps = (existing: LibraryMarker | null) => {
    const written: { path: string; content: string }[] = [];
    const made: string[] = [];
    return {
      written,
      made,
      deps: {
        readMarker: async () => existing,
        createDirectory: async (path: string) => {
          made.push(path);
        },
        writeFile: async (path: string, content: string) => {
          written.push({ path, content });
        },
        deviceName: async () => "Peter's MacBook Pro",
      },
    };
  };

  it("writes migratedFrom into the container's marker", async () => {
    // THE step that makes a migration stick. Without it startup re-resolves
    // the root, cannot see that a migration happened, and falls through to
    // "the old folder still has something in it" — pointing the app back at
    // the folder it just emptied.
    const created = newLibraryMarker("ios", "2026-09-01T10:00:00.000Z");
    const { deps: d, written } = deps(created);

    const marker = await recordMigrationInMarker("/new", d, "2026-09-06T18:00:00.000Z");

    expect(marker.migratedFrom).toBe(LEGACY_CLOUD_DOCS_LIBRARY);
    expect(marker.migratedAt).toBe("2026-09-06T18:00:00.000Z");
    expect(marker.migratedBy).toBe("Peter's MacBook Pro");
    // The phone created this library; the migration extends its marker
    // rather than replacing it.
    expect(marker.createdBy).toBe("ios");
    expect(marker.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(written[0].path).toBe("/new/.notesage/library.json");
    expect(JSON.parse(written[0].content).migratedFrom).toBe(LEGACY_CLOUD_DOCS_LIBRARY);
  });

  it("marks an UNMARKED container rather than leaving it unmarked", async () => {
    // A container this Mac is the first to use has no marker: the phone
    // writes one when IT creates the library. Migrating into an unmarked
    // root and leaving it unmarked is the exact state that reads as "never
    // migrated" on the next launch.
    const { deps: d, written, made } = deps(null);

    const marker = await recordMigrationInMarker("/new", d, "2026-09-06T18:00:00.000Z");

    expect(marker.createdBy).toBe("macos");
    expect(marker.migratedFrom).toBe(LEGACY_CLOUD_DOCS_LIBRARY);
    expect(made).toContain("/new/.notesage");
    expect(written).toHaveLength(1);
  });

  it("keeps the FIRST migration's record when run again", async () => {
    // Re-running (a resumed migration, a retry after a partial failure) must
    // not restamp the record every other device followed.
    const first = markMigrated(newLibraryMarker("ios", "2026-09-01T10:00:00.000Z"), {
      from: LEGACY_CLOUD_DOCS_LIBRARY,
      by: "an older Mac",
      at: "2026-09-02T09:00:00.000Z",
    });
    const { deps: d } = deps(first);

    const marker = await recordMigrationInMarker("/new", d, "2026-09-06T18:00:00.000Z");

    expect(marker.migratedAt).toBe("2026-09-02T09:00:00.000Z");
    expect(marker.migratedBy).toBe("an older Mac");
  });

  it("takes the migration back off the marker for an undo", async () => {
    // The mirror image of writing it. While `migratedFrom` stands, every
    // device — this Mac included — resolves the library to a container the
    // files have just left, so the next launch comes back to an empty one.
    const migrated = markMigrated(newLibraryMarker("ios", "2026-09-01T10:00:00.000Z"), {
      from: LEGACY_CLOUD_DOCS_LIBRARY,
      by: "Peter's MacBook Pro",
      at: "2026-09-06T18:00:00.000Z",
    });
    const { deps: d, written } = deps(migrated);

    const cleared = await clearMigrationInMarker("/new", d);

    expect(cleared?.migratedFrom).toBeUndefined();
    expect(cleared?.migratedAt).toBeUndefined();
    expect(cleared?.migratedBy).toBeUndefined();
    // The rest of the marker is the phone's, and is not this Mac's to rewrite.
    expect(cleared?.createdBy).toBe("ios");
    expect(cleared?.createdAt).toBe("2026-09-01T10:00:00.000Z");
    expect(JSON.parse(written[0].content).migratedFrom).toBeUndefined();
  });

  it("writes no marker at all when the container has none", async () => {
    // There is nothing to clear, and inventing a marker for a root being
    // emptied would be a claim about it that is not true.
    const { deps: d, written } = deps(null);

    await expect(clearMigrationInMarker("/new", d)).resolves.toBeNull();
    expect(written).toEqual([]);
  });
});

describe("reading a root for planning", () => {
  it("lets a failed ROOT listing throw, so it cannot pass as an empty library", async () => {
    // The finding this locks: `.catch(() => [])` made an unreachable library
    // indistinguishable from an empty one. An empty source plans zero steps,
    // the run reports success, and the caller then records the migration and
    // repoints the app at a container holding nothing — which
    // `resolveSyncedLibraryRoot` follows for ever. One transient iCloud
    // fault, one permanently empty-looking library.
    setMockInvokeHandler("list_directory", () => {
      throw new Error("iCloud is not responding");
    });
    await expect(buildMigrationListing("/old")).rejects.toThrow("iCloud is not responding");
  });

  it("still tolerates a missing Inbox, which is not a fault", async () => {
    // Absence is read off the root listing, not from a failed call, so the
    // two cannot be confused.
    setMockInvokeHandler("list_directory", () => [
      { name: "a.md", path: "/old/a.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("path_exists", () => false);
    const listing = await buildMigrationListing("/old");
    expect(listing.entries.map((e) => e.name)).toEqual(["a.md"]);
    expect(listing.inbox).toEqual([]);
  });

  it("lets an Inbox that EXISTS but cannot be read throw", async () => {
    // Catching this into `[]` plans no Inbox steps at all, so every captured
    // article stays behind while the report says the migration completed.
    setMockInvokeHandler("list_directory", (args) =>
      String(args?.path ?? "").endsWith("/Inbox")
        ? (() => {
            throw new Error("permission denied");
          })()
        : [{ name: "Inbox", path: "/old/Inbox", is_directory: true, hidden: false }],
    );
    setMockInvokeHandler("path_exists", () => false);
    await expect(buildMigrationListing("/old")).rejects.toThrow("permission denied");
  });

  it("lets a failed project check throw rather than demoting a project to a folder", async () => {
    // A demoted project is a PLAIN FOLDER, and same-named plain folders are
    // MERGED — combining two sets of settings, comments and AI locks that
    // were never meant to meet, which is the one outcome the collision rules
    // exist to prevent.
    setMockInvokeHandler("list_directory", () => [
      { name: "Research", path: "/old/Research", is_directory: true, hidden: false },
    ]);
    setMockInvokeHandler("path_exists", () => {
      throw new Error("iCloud is not responding");
    });
    await expect(buildMigrationListing("/old")).rejects.toThrow("iCloud is not responding");
  });
});

describe("finding the comment sidecars", () => {
  it("names the ones it cannot re-key instead of dropping them silently", async () => {
    // The key IS a hash of the document path, so a sidecar that cannot be
    // re-keyed leaves every comment on that note unreachable once the note
    // moves — bytes intact, which is what makes it read as loss.
    setMockInvokeHandler("path_exists", () => true);
    setMockInvokeHandler("list_directory", () => [
      { name: "path-aaa.json", path: "/n/.notesage/comments/path-aaa.json", is_directory: false, hidden: false },
      { name: "path-bbb.json", path: "/n/.notesage/comments/path-bbb.json", is_directory: false, hidden: false },
      { name: "path-ccc.json", path: "/n/.notesage/comments/path-ccc.json", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("read_file", (args) => {
      const name = String(args?.path ?? "");
      if (name.endsWith("path-aaa.json")) return JSON.stringify({ originalPath: "/old/a.md" });
      if (name.endsWith("path-bbb.json")) return JSON.stringify({ comments: [] }); // no originalPath
      throw new Error("unreadable");
    });

    const scan = await collectSidecarFilePaths("/n");
    expect(scan.paths).toEqual(["/old/a.md"]);
    expect(scan.unreadable).toEqual(["path-bbb.json", "path-ccc.json"]);
  });

  it("treats a missing comments directory as nothing to do, not a fault", async () => {
    setMockInvokeHandler("path_exists", () => false);
    await expect(collectSidecarFilePaths("/n")).resolves.toEqual({ paths: [], unreadable: [] });
  });

  it("lets an unreadable comments directory throw rather than orphaning every sidecar", async () => {
    setMockInvokeHandler("path_exists", () => true);
    setMockInvokeHandler("list_directory", () => {
      throw new Error("permission denied");
    });
    await expect(collectSidecarFilePaths("/n")).rejects.toThrow("permission denied");
  });
});
