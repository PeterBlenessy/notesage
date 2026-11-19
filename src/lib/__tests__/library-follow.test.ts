import { describe, it, expect } from "vitest";
import {
  COLLISION_SUFFIX,
  followPath,
  isHeldForLibraryAccess,
  planLibraryFollow,
} from "@/lib/library-follow";

const OLD = "/Users/w/Library/Mobile Documents/com~apple~CloudDocs/Notesage";
const NEW = "/Users/w/Library/Mobile Documents/iCloud~com~notesage~app/Documents";

function fs(paths: string[]) {
  const set = new Set(paths);
  return async (p: string) => set.has(p);
}

describe("following a library move another Mac performed", () => {
  it("follows an entry that is gone from the old root and present in the new one", async () => {
    const plan = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [`${OLD}/Work`, `${OLD}/Work/notes/a.md`],
      exists: fs([`${NEW}/Work`]),
    });
    expect(plan.renames).toEqual([{ from: "Work", to: "Work" }]);
    expect(followPath(`${OLD}/Work/notes/a.md`, plan, OLD, NEW)).toBe(`${NEW}/Work/notes/a.md`);
  });

  it("leaves an entry that is still in the old root where it is", async () => {
    // A leftover, or a step of the migration that failed: rewriting it would
    // point the sidebar away from files that are really still there.
    const plan = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [`${OLD}/Work`],
      exists: fs([`${OLD}/Work`, `${NEW}/Work`]),
    });
    expect(plan.renames).toEqual([]);
    expect(followPath(`${OLD}/Work`, plan, OLD, NEW)).toBeNull();
  });

  it("does not invent a destination that is not there", async () => {
    const plan = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [`${OLD}/Gone`],
      exists: fs([]),
    });
    expect(plan.renames).toEqual([]);
  });

  it("prefers the collision-renamed copy, which is THIS Mac's project", async () => {
    // The migration keeps both on a name clash and renames the moved one.
    // The plain name in the container is a different project.
    const plan = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [`${OLD}/Recipes/pie.md`],
      exists: fs([`${NEW}/Recipes`, `${NEW}/Recipes${COLLISION_SUFFIX}`]),
    });
    expect(followPath(`${OLD}/Recipes/pie.md`, plan, OLD, NEW)).toBe(
      `${NEW}/Recipes${COLLISION_SUFFIX}/pie.md`,
    );
  });

  it("matches at a path boundary, so a sibling with a longer name is untouched", async () => {
    const plan = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [`${OLD}/Notes`],
      exists: fs([`${NEW}/Notes`, `${OLD}/Notes Archive`]),
    });
    expect(followPath(`${OLD}/Notes Archive/x.md`, plan, OLD, NEW)).toBeNull();
    expect(followPath("/Users/w/Local/Notes", plan, OLD, NEW)).toBeNull();
  });

  it("follows the old root itself only when something under it moved", async () => {
    const moved = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [OLD, `${OLD}/Inbox/a.md`],
      exists: fs([`${NEW}/Inbox`]),
    });
    expect(followPath(OLD, moved, OLD, NEW)).toBe(NEW);

    const nothing = await planLibraryFollow({ oldRoot: OLD, newRoot: NEW, paths: [OLD], exists: fs([]) });
    expect(followPath(OLD, nothing, OLD, NEW)).toBeNull();
  });

  it("decides nothing for an entry whose existence check throws", async () => {
    const plan = await planLibraryFollow({
      oldRoot: OLD,
      newRoot: NEW,
      paths: [`${OLD}/Work`],
      exists: async () => {
        throw new Error("iCloud hiccup");
      },
    });
    expect(plan.renames).toEqual([]);
  });
});

describe("holding unreadable library entries while access is denied", () => {
  it("holds a path in the old library only while the container is denied", () => {
    expect(isHeldForLibraryAccess(`${OLD}/Work`, OLD, true)).toBe(true);
    expect(isHeldForLibraryAccess(`${OLD}/Work`, OLD, false)).toBe(false);
    expect(isHeldForLibraryAccess("/Users/w/Local/Work", OLD, true)).toBe(false);
    expect(isHeldForLibraryAccess(`${OLD}/Work`, null, true)).toBe(false);
  });
});
