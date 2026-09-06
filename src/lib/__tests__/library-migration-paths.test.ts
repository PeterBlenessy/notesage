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
      updateProjectPath: vi.fn(() => order.push("project")),
      renameOpenDocument: vi.fn(() => order.push("document")),
      updateFilePaths: vi.fn(() => order.push("pins")),
      migrateSidecars: vi.fn(async () => {
        order.push("sidecars");
      }),
    });
    expect(order).toEqual(["project", "document", "pins", "sidecars"]);
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
