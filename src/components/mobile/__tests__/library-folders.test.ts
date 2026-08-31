// @vitest-environment jsdom
/**
 * The destination list for "Move to folder" (#832).
 *
 * Bounded on purpose: a library lives in iCloud and can hold anything the user
 * put there, so an unbounded walk would stall the picker with no way out —
 * the same reason the filename search is bounded (#783).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const listMock = vi.fn<(rel: string) => Promise<unknown[]>>();
vi.mock("@/lib/ios-api", () => ({ iosListDirectory: (rel: string) => listMock(rel) }));

import { collectFolders } from "../library-folders";

const dir = (name: string, path: string, extra: Record<string, unknown> = {}) => ({
  name, path, is_directory: true, hidden: false, ...extra,
});
const file = (name: string, path: string) => ({ name, path, is_directory: false, hidden: false });

beforeEach(() => listMock.mockReset());

describe("collectFolders", () => {
  it("always offers the library root, labelled so it is not blank", async () => {
    listMock.mockResolvedValue([]);
    await expect(collectFolders()).resolves.toEqual([{ path: "", label: "/" }]);
  });

  it("returns folders and never files", async () => {
    listMock.mockImplementation(async (rel) =>
      rel === "" ? [dir("Inbox", "Inbox"), file("a.md", "a.md")] : [],
    );
    const paths = (await collectFolders()).map((f) => f.path);
    expect(paths).toContain("Inbox");
    expect(paths).not.toContain("a.md");
  });

  it("skips hidden folders — .notesage is metadata, not a destination", async () => {
    listMock.mockImplementation(async (rel) =>
      rel === ""
        ? [dir(".notesage", ".notesage", { hidden: true }), dir("Archive", "Archive")]
        : [],
    );
    const paths = (await collectFolders()).map((f) => f.path);
    expect(paths).toContain("Archive");
    expect(paths).not.toContain(".notesage");
  });

  it("stops descending rather than walking an unbounded tree", async () => {
    // Every folder contains another folder, for ever.
    listMock.mockImplementation(async (rel) => [dir("deeper", `${rel}${rel ? "/" : ""}deeper`)]);
    const folders = await collectFolders();
    expect(folders.length).toBeLessThan(10);
    expect(listMock.mock.calls.length).toBeLessThan(20);
  });

  it("survives an unreadable subtree instead of failing the whole picker", async () => {
    listMock.mockImplementation(async (rel) => {
      if (rel === "") return [dir("Good", "Good"), dir("Broken", "Broken")];
      if (rel === "Broken") throw new Error("unreadable");
      return [];
    });
    const paths = (await collectFolders()).map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(["", "Good", "Broken"]));
  });
});
