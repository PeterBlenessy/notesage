import { describe, it, expect } from "vitest";
import { buildTrayRecents } from "@/lib/tray-recents";

const tab = (filePath: string) => ({ filePath });

describe("buildTrayRecents", () => {
  it("filters recents to the selected project plus notes root", () => {
    const tabs = [
      tab("/Users/me/Projects/A/note1.md"),
      tab("/Users/me/Projects/B/leak.md"),
      tab("/Users/me/Notesage/quick.md"),
      tab("/Users/me/Projects/A/note2.md"),
    ];

    const { scoped } = buildTrayRecents({
      tabs,
      selectedProjectPaths: ["/Users/me/Projects/A"],
      notesRootPath: "/Users/me/Notesage",
      limit: 5,
    });

    expect(scoped.map((f) => f.path)).toEqual([
      "/Users/me/Projects/A/note2.md",
      "/Users/me/Notesage/quick.md",
      "/Users/me/Projects/A/note1.md",
    ]);
    expect(scoped.some((f) => f.path.includes("/Projects/B/"))).toBe(false);
  });

  it("always returns the unfiltered superset for the All Recent submenu", () => {
    const tabs = [
      tab("/Users/me/Projects/A/a.md"),
      tab("/Users/me/Projects/B/b.md"),
    ];

    const { all } = buildTrayRecents({
      tabs,
      selectedProjectPaths: ["/Users/me/Projects/A"],
      notesRootPath: "/Users/me/Notesage",
      limit: 5,
    });

    expect(all.map((f) => f.path).sort()).toEqual([
      "/Users/me/Projects/A/a.md",
      "/Users/me/Projects/B/b.md",
    ]);
  });

  it("falls back to the unfiltered list when no project is selected", () => {
    const tabs = [
      tab("/Users/me/Projects/A/a.md"),
      tab("/Users/me/Projects/B/b.md"),
    ];

    const { scoped, all } = buildTrayRecents({
      tabs,
      selectedProjectPaths: [],
      notesRootPath: "/Users/me/Notesage",
      limit: 5,
    });

    expect(scoped).toEqual(all);
    expect(scoped).toHaveLength(2);
  });

  it("uses the basename as the display name", () => {
    const { all } = buildTrayRecents({
      tabs: [tab("/Users/me/Projects/A/deep/nested/note.md")],
      selectedProjectPaths: [],
      notesRootPath: "",
      limit: 5,
    });
    expect(all[0]).toEqual({
      name: "note.md",
      path: "/Users/me/Projects/A/deep/nested/note.md",
    });
  });

  it("does not match sibling paths that share a prefix", () => {
    const tabs = [
      tab("/Users/me/Projects/A/note.md"),
      tab("/Users/me/Projects/A-backup/note.md"),
    ];

    const { scoped } = buildTrayRecents({
      tabs,
      selectedProjectPaths: ["/Users/me/Projects/A"],
      notesRootPath: "",
      limit: 5,
    });

    expect(scoped.map((f) => f.path)).toEqual(["/Users/me/Projects/A/note.md"]);
  });

  it("respects the limit after slicing recent tabs", () => {
    const tabs = Array.from({ length: 8 }, (_, i) =>
      tab(`/Users/me/Projects/A/note-${i}.md`),
    );

    const { all, scoped } = buildTrayRecents({
      tabs,
      selectedProjectPaths: [],
      notesRootPath: "",
      limit: 3,
    });

    expect(all).toHaveLength(3);
    expect(scoped).toEqual(all);
    // Most recent first, last three of eight.
    expect(all.map((f) => f.path)).toEqual([
      "/Users/me/Projects/A/note-7.md",
      "/Users/me/Projects/A/note-6.md",
      "/Users/me/Projects/A/note-5.md",
    ]);
  });
});
