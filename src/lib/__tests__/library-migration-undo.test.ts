import { describe, it, expect, vi } from "vitest";
import {
  isUndoRecord,
  latestUndoRecord,
  undoLibraryMigration,
  type UndoRecord,
  type UndoStoreDeps,
} from "../library-migration-undo";

/**
 * The undo record is read back from disk and then drives moves, writes and
 * deletes. It used to be accepted on `typeof id === "string"` and
 * `Array.isArray(moves)` alone (audit 2026-11-22 §7).
 */

function validRecord(): UndoRecord {
  return {
    id: "m1",
    at: "2026-11-22T10:00:00.000Z",
    oldRoot: "/Users/me/Library/Mobile Documents/com~apple~CloudDocs/Notesage",
    newRoot: "/Users/me/Library/Mobile Documents/iCloud~com~notesage~app/Documents",
    moves: [{ from: "Work", to: "Work" }, { from: "Notes/a.md", to: "Notes/a 2.md" }],
    destroyed: [
      { root: "new", path: ".notesage/pins.json", content: "[]" },
      { root: "old", path: ".notesage/reading-progress.json", content: null },
    ],
  };
}

function with_(patch: Record<string, unknown>): unknown {
  return { ...validRecord(), ...patch };
}

describe("isUndoRecord", () => {
  it("accepts a record the migration writes", () => {
    expect(isUndoRecord(validRecord())).toBe(true);
    expect(isUndoRecord(with_({ moves: [], destroyed: [] }))).toBe(true);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["no id", with_({ id: undefined })],
    ["an empty id", with_({ id: "" })],
    ["no timestamp", with_({ at: undefined })],
    ["no oldRoot", with_({ oldRoot: undefined })],
    ["an empty newRoot", with_({ newRoot: "" })],
    ["a relative root", with_({ oldRoot: "Notesage" })],
    ["the filesystem root as a root", with_({ newRoot: "/" })],
    ["no destroyed list", with_({ destroyed: undefined })],
    ["moves that is not a list", with_({ moves: {} })],
    ["a move with no target", with_({ moves: [{ from: "Work" }] })],
    ["a move with an empty path", with_({ moves: [{ from: "", to: "Work" }] })],
    ["an absolute move path", with_({ moves: [{ from: "/etc", to: "Work" }] })],
    ["a move that climbs out", with_({ moves: [{ from: "Work", to: "../../Documents" }] })],
    ["a move with a .. in the middle", with_({ moves: [{ from: "a/../../b", to: "b" }] })],
    ["a destroyed entry with an empty path", with_({ destroyed: [{ root: "new", path: "", content: null }] })],
    ["a destroyed entry that climbs out", with_({ destroyed: [{ root: "new", path: "../x", content: null }] })],
    ["a destroyed entry with an unknown root", with_({ destroyed: [{ root: "other", path: "a", content: null }] })],
    ["a destroyed entry with non-string content", with_({ destroyed: [{ root: "old", path: "a", content: 3 }] })],
  ])("rejects %s", (_label, value) => {
    expect(isUndoRecord(value)).toBe(false);
  });
});

describe("undoLibraryMigration refuses a damaged record", () => {
  function deps() {
    return {
      moveEntry: vi.fn(async () => "moved"),
      exists: vi.fn(async () => true),
      writeFile: vi.fn(async () => {}),
      deletePath: vi.fn(async () => {}),
    };
  }

  it("does not delete the library root for an empty destroyed path", async () => {
    const d = deps();
    const record = with_({ moves: [], destroyed: [{ root: "new", path: "", content: null }] }) as UndoRecord;
    await expect(undoLibraryMigration(record, d)).rejects.toThrow(/damaged/);
    expect(d.deletePath).not.toHaveBeenCalled();
    expect(d.moveEntry).not.toHaveBeenCalled();
  });

  it("does not move to an `undefined/…` target when the roots are missing", async () => {
    const d = deps();
    const record = with_({ oldRoot: undefined }) as UndoRecord;
    await expect(undoLibraryMigration(record, d)).rejects.toThrow();
    expect(d.moveEntry).not.toHaveBeenCalled();
    expect(d.writeFile).not.toHaveBeenCalled();
  });

  it("still reverses a valid record", async () => {
    const d = deps();
    const report = await undoLibraryMigration(validRecord(), d);
    expect(report.failed).toEqual([]);
    expect(d.moveEntry).toHaveBeenCalledTimes(2);
  });
});

describe("latestUndoRecord skips records that fail the guard", () => {
  function storeWith(files: Record<string, unknown>): UndoStoreDeps {
    return {
      createDirectory: async () => {},
      writeFile: async () => {},
      deletePath: async () => {},
      pathExists: async () => true,
      listDirectory: async () => Object.keys(files).map((name) => ({ name, is_directory: false })),
      readFile: async (path) => JSON.stringify(files[path.split("/").pop() ?? ""]),
    };
  }

  it("returns the newest VALID record, not a newer damaged one", async () => {
    const older = { ...validRecord(), id: "older", at: "2026-11-01T00:00:00.000Z" };
    const damaged = with_({ id: "damaged", at: "2026-11-30T00:00:00.000Z", newRoot: undefined });
    const record = await latestUndoRecord("/Users/me", storeWith({ "a.json": damaged, "b.json": older }));
    expect(record?.id).toBe("older");
  });

  it("returns null when the only record is damaged", async () => {
    const damaged = with_({ destroyed: [{ root: "new", path: "", content: null }] });
    expect(await latestUndoRecord("/Users/me", storeWith({ "a.json": damaged }))).toBeNull();
  });
});
