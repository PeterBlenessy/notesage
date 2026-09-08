// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { tauriApi } from "@/lib/tauri";
import {
  LibraryLockedError,
  assertLibraryUnlocked,
  isLibraryPathLocked,
  lockLibraryRoots,
  unlockLibraryRoots,
} from "@/lib/library-lock";

const OLD = "/Users/peter/Library/Mobile Documents/com~apple~CloudDocs/Notesage";
const NEW = "/Users/peter/Library/Mobile Documents/iCloud~com~notesage~app/Documents";

describe("holding the library while it moves", () => {
  beforeEach(() => unlockLibraryRoots());

  it("refuses a write into a root that is being moved", () => {
    // The failure it prevents is silent and permanent: `write_file` CREATES a
    // missing file, so an autosave landing after its note has moved recreates
    // that note at the abandoned root with the newest edit in it, while the
    // migration has already counted the old copy as moved.
    lockLibraryRoots([OLD, NEW]);
    expect(() => assertLibraryUnlocked(`${OLD}/note.md`)).toThrow(LibraryLockedError);
    expect(() => assertLibraryUnlocked(`${NEW}/note.md`)).toThrow(LibraryLockedError);
  });

  it("matches at a path boundary, so a sibling folder is not caught", () => {
    lockLibraryRoots([OLD]);
    expect(isLibraryPathLocked(`${OLD}-backup/note.md`)).toBe(false);
    expect(isLibraryPathLocked(`${OLD}/note.md`)).toBe(true);
  });

  it("leaves everything outside the library alone", () => {
    lockLibraryRoots([OLD]);
    expect(() => assertLibraryUnlocked("/Users/peter/Code/x.md")).not.toThrow();
  });

  it("lets go, so the app can save again", () => {
    lockLibraryRoots([OLD]);
    unlockLibraryRoots();
    expect(() => assertLibraryUnlocked(`${OLD}/note.md`)).not.toThrow();
  });

  it("stops a real save through the file API", async () => {
    let written = false;
    setMockInvokeHandler("write_file", () => {
      written = true;
    });
    lockLibraryRoots([OLD]);
    await expect(tauriApi.writeFile(`${OLD}/note.md`, "edit")).rejects.toThrow(LibraryLockedError);
    expect(written, "the write must never reach the backend").toBe(false);
  });

  it("still lets the migration's own writes through", async () => {
    // Separate entry points, not an exemption flag: a flag would have to be
    // set around each awaited call, and anything else running during that
    // await would be exempt too — the race the lock exists to close.
    let written = false;
    setMockInvokeHandler("write_file", () => {
      written = true;
    });
    lockLibraryRoots([OLD, NEW]);
    await tauriApi.migrationWriteFile(`${NEW}/note.md`, "moved");
    expect(written).toBe(true);
  });

  it("guards deletes, renames and directory creation too", async () => {
    lockLibraryRoots([OLD]);
    await expect(tauriApi.deletePath(`${OLD}/note.md`)).rejects.toThrow(LibraryLockedError);
    await expect(tauriApi.trashPath(`${OLD}/note.md`)).rejects.toThrow(LibraryLockedError);
    await expect(tauriApi.createDirectory(`${OLD}/New`)).rejects.toThrow(LibraryLockedError);
    await expect(tauriApi.createFile(`${OLD}/new.md`)).rejects.toThrow(LibraryLockedError);
    // Either end of a rename is enough to refuse it.
    await expect(tauriApi.renamePath("/elsewhere/a.md", `${OLD}/a.md`)).rejects.toThrow(
      LibraryLockedError,
    );
  });
});
