// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import {
  buildMigrationListing,
  mergePinsFiles,
  migrationDeps,
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
});
