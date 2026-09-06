// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { buildMigrationListing, mergePinsFiles, migrationDeps } from "@/lib/library-migration-run";

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
