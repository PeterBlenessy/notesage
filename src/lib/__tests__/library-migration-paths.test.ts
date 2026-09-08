import { describe, it, expect, vi } from "vitest";
import {
  applyPathRewrites,
  isUnder,
  planPathRewrites,
  rebase,
} from "@/lib/library-migration-paths";
import { hashPath } from "@/lib/comment-storage";

const OLD = "/Users/p/Library/Mobile Documents/com~apple~CloudDocs/Notesage";
const NEW = "/Users/p/Library/Mobile Documents/iCloud~com~notesage~app/Documents";
const COMMENTS = "/Users/p/Notesage/.notesage/comments";

describe("rebasing a path onto the new library root (2026-09-06)", () => {
  it("matches only at a boundary", () => {
    // `/a/bc` is not inside `/a/b`. A bare `startsWith` here silently
    // rewrites a sibling folder whose name happens to share a prefix.
    expect(isUnder("/a/b", "/a/b")).toBe(true);
    expect(isUnder("/a/b/c", "/a/b")).toBe(true);
    expect(isUnder("/a/bc", "/a/b")).toBe(false);
  });

  it("leaves anything outside the old root alone", () => {
    expect(rebase("/Users/p/Elsewhere/x.md", OLD, NEW)).toBeNull();
  });

  it("swaps the root and keeps the rest", () => {
    expect(rebase(`${OLD}/Research/note.md`, OLD, NEW)).toBe(`${NEW}/Research/note.md`);
  });
});

describe("planning the rewrites", () => {
  it("moves projects, documents and sidecars under the old root, and nothing else", () => {
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [`${OLD}/Research`, "/Users/p/Local/Other"],
      documentPaths: [`${OLD}/Research/a.md`, "/Users/p/Local/Other/b.md"],
      sidecarFilePaths: [`${OLD}/loose.md`],
      commentsDir: COMMENTS,
    });
    expect(plan.projects).toEqual([{ from: `${OLD}/Research`, to: `${NEW}/Research` }]);
    expect(plan.documents).toEqual([{ from: `${OLD}/Research/a.md`, to: `${NEW}/Research/a.md` }]);
    expect(plan.sidecars).toHaveLength(1);
  });

  it("re-keys a comment sidecar, because the key IS the path", () => {
    // A non-project file's comments are stored under a hash of its path.
    // Move the file and the key changes; leave the sidecar and every comment
    // on it is orphaned while still sitting on disk.
    const from = `${OLD}/loose.md`;
    const to = `${NEW}/loose.md`;
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [],
      documentPaths: [],
      sidecarFilePaths: [from],
      commentsDir: COMMENTS,
    });
    expect(plan.sidecars[0]).toEqual({
      oldSidecar: `${COMMENTS}/path-${hashPath(from)}.json`,
      newSidecar: `${COMMENTS}/path-${hashPath(to)}.json`,
      newFilePath: to,
    });
    expect(plan.sidecars[0].oldSidecar).not.toBe(plan.sidecars[0].newSidecar);
  });
});

describe("applying the rewrites", () => {
  it("updates the stores before touching a sidecar", async () => {
    // Store updates are synchronous and cannot fail. Doing them first means a
    // sidecar failure leaves the app pointing at the right files with some
    // comments unmigrated — visible and recoverable. The reverse looks like
    // the library disappeared.
    const order: string[] = [];
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [`${OLD}/R`],
      documentPaths: [`${OLD}/R/a.md`],
      sidecarFilePaths: [`${OLD}/loose.md`],
      commentsDir: COMMENTS,
    });
    await applyPathRewrites(plan, {
      updateProjectPath: vi.fn(() => {
        order.push("project");
      }),
      renameOpenDocument: vi.fn(() => order.push("document")),
      updateFilePaths: vi.fn(() => order.push("pins")),
      migrateSidecars: vi.fn(async () => {
        order.push("sidecars");
      }),
    });
    expect(order).toEqual(["project", "document", "pins", "sidecars"]);
  });

  it("waits for each project's tree before moving on", async () => {
    // The re-read is async. If it is not awaited, the ordering this function
    // exists to guarantee — stores settled before sidecars — is lost, and a
    // project can still be showing its old tree when the run reports done.
    const order: string[] = [];
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [`${OLD}/R`],
      documentPaths: [],
      sidecarFilePaths: [`${OLD}/loose.md`],
      commentsDir: COMMENTS,
    });
    await applyPathRewrites(plan, {
      updateProjectPath: async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("project");
      },
      renameOpenDocument: vi.fn(),
      updateFilePaths: vi.fn(),
      migrateSidecars: vi.fn(async () => {
        order.push("sidecars");
      }),
    });
    expect(order).toEqual(["project", "sidecars"]);
  });

  it("does not call the sidecar migration when there is nothing to migrate", async () => {
    const migrateSidecars = vi.fn(async () => {});
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [],
      documentPaths: [],
      sidecarFilePaths: [],
      commentsDir: COMMENTS,
    });
    await applyPathRewrites(plan, {
      updateProjectPath: vi.fn(),
      renameOpenDocument: vi.fn(),
      updateFilePaths: vi.fn(),
      migrateSidecars,
    });
    expect(migrateSidecars).not.toHaveBeenCalled();
  });
});

describe("rewrites follow the renames the migration made (2026-09-06)", () => {
  const OLD = "/old/Notesage";
  const NEW = "/new/Notesage";

  it("sends a collision-renamed project to the name it actually got", () => {
    // The case that makes this more than tidiness: two projects called
    // "Research", one on each side. The source is kept as
    // "Research (from iCloud Drive)" — and a plain rebase points the
    // workspace entry, recents and pins at `<new>/Research`, which is the
    // OTHER project. Every subsequent edit would land in it.
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [`${OLD}/Research`],
      documentPaths: [`${OLD}/Research/notes/today.md`],
      sidecarFilePaths: [],
      commentsDir: "/home/.notesage/comments",
      renames: [{ from: "Research", to: "Research (from iCloud Drive)" }],
    });

    expect(plan.projects).toEqual([
      { from: `${OLD}/Research`, to: `${NEW}/Research (from iCloud Drive)` },
    ]);
    expect(plan.documents).toEqual([
      {
        from: `${OLD}/Research/notes/today.md`,
        to: `${NEW}/Research (from iCloud Drive)/notes/today.md`,
      },
    ]);
  });

  it("re-keys a comment sidecar under the renamed path", () => {
    // The sidecar's filename is a hash OF THE PATH, so a rename it does not
    // know about re-keys the comments onto a file that is not theirs.
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [],
      documentPaths: [],
      sidecarFilePaths: [`${OLD}/note.md`],
      commentsDir: "/home/.notesage/comments",
      renames: [{ from: "note.md", to: "note-1.md" }],
    });

    expect(plan.sidecars[0].newFilePath).toBe(`${NEW}/note-1.md`);
  });

  it("prefers the longest rename, so a renamed child inside a renamed folder lands right", () => {
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [],
      documentPaths: [`${OLD}/Notes/deep/a.md`],
      sidecarFilePaths: [],
      commentsDir: "/home/.notesage/comments",
      renames: [
        { from: "Notes", to: "Notes-1" },
        { from: "Notes/deep", to: "Notes-1/deep-1" },
      ],
    });

    expect(plan.documents[0].to).toBe(`${NEW}/Notes-1/deep-1/a.md`);
  });

  it("matches a rename only at a path boundary", () => {
    // `Notes` must not rewrite `Notes Archive` — the bug that silently moves
    // a whole neighbouring tree.
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [`${OLD}/Notes Archive`],
      documentPaths: [],
      sidecarFilePaths: [],
      commentsDir: "/home/.notesage/comments",
      renames: [{ from: "Notes", to: "Notes-1" }],
    });

    expect(plan.projects[0].to).toBe(`${NEW}/Notes Archive`);
  });

  it("corrects pins after the prefix sweep, which cannot express a rename", () => {
    const plan = planPathRewrites({
      oldRoot: OLD,
      newRoot: NEW,
      projectPaths: [],
      documentPaths: [],
      sidecarFilePaths: [],
      commentsDir: "/home/.notesage/comments",
      renames: [{ from: "note.md", to: "note-1.md" }],
    });

    // Post-swap terms: the sweep has already moved the pin to `<new>/note.md`.
    expect(plan.renamedPins).toEqual([{ from: `${NEW}/note.md`, to: `${NEW}/note-1.md` }]);

    const calls: { from: string; to: string }[] = [];
    void applyPathRewrites(plan, {
      updateProjectPath: () => {},
      renameOpenDocument: () => {},
      updateFilePaths: (from, to) => calls.push({ from, to }),
      migrateSidecars: async () => {},
    });
    // Order matters: the correction has to run after the sweep it corrects.
    expect(calls).toEqual([
      { from: OLD, to: NEW },
      { from: `${NEW}/note.md`, to: `${NEW}/note-1.md` },
    ]);
  });
});
