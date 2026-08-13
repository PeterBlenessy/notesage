// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileEntry } from "@/lib/tauri";

vi.mock("@/lib/ios-api", () => ({
  iosContextMenu: vi.fn(),
  iosDeleteFile: vi.fn(async () => {}),
  iosRenameFile: vi.fn(async () => "renamed.md"),
  iosShareFile: vi.fn(async () => {}),
  iosTextPrompt: vi.fn(async () => null),
}));

import {
  iosContextMenu,
  iosDeleteFile,
  iosRenameFile,
  iosShareFile,
  iosTextPrompt,
} from "@/lib/ios-api";
import {
  entryMenuItems,
  runEntryAction,
  presentEntryMenu,
  confirmDelete,
} from "@/lib/mobile-entry-actions";

const file: FileEntry = {
  name: "note.md",
  path: "Ideas/note.md",
  is_directory: false,
  hidden: false,
};
const folder: FileEntry = { ...file, name: "Ideas", path: "Ideas", is_directory: true };

function ctx(overrides: Partial<Parameters<typeof runEntryAction>[2]> = {}) {
  return {
    isPinned: () => false,
    togglePin: vi.fn(async () => {}),
    onChanged: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("entryMenuItems", () => {
  it("offers share, rename, pin and delete for a file, with delete destructive", () => {
    const items = entryMenuItems(file, ctx());
    expect(items.map((i) => i.id)).toEqual(["share", "rename", "pin", "delete"]);
    expect(items.find((i) => i.id === "delete")?.destructive).toBe(true);
  });

  it("omits share for a folder — ios_share_file copies a single file", () => {
    expect(entryMenuItems(folder, ctx()).map((i) => i.id)).toEqual([
      "rename",
      "pin",
      "delete",
    ]);
  });

  it("labels the pin row by current state", () => {
    expect(entryMenuItems(file, ctx()).find((i) => i.id === "pin")?.title).toBe("Pin");
    expect(
      entryMenuItems(file, ctx({ isPinned: () => true })).find((i) => i.id === "pin")?.title,
    ).toBe("Unpin");
  });
});

describe("runEntryAction", () => {
  it("deletes only after the confirmation sheet is accepted", async () => {
    vi.mocked(iosContextMenu).mockResolvedValueOnce("delete");
    const c = ctx();
    await runEntryAction("delete", file, c);
    expect(iosDeleteFile).toHaveBeenCalledWith("Ideas/note.md");
    expect(c.onChanged).toHaveBeenCalled();
  });

  it("does not delete when the confirmation is dismissed", async () => {
    vi.mocked(iosContextMenu).mockResolvedValueOnce(null);
    await runEntryAction("delete", file, ctx());
    expect(iosDeleteFile).not.toHaveBeenCalled();
  });

  it("renames with the entered name, and skips an unchanged or empty one", async () => {
    vi.mocked(iosTextPrompt).mockResolvedValueOnce("better.md");
    await runEntryAction("rename", file, ctx());
    expect(iosRenameFile).toHaveBeenCalledWith("Ideas/note.md", "better.md");

    vi.mocked(iosTextPrompt).mockResolvedValueOnce("note.md"); // unchanged
    await runEntryAction("rename", file, ctx());
    vi.mocked(iosTextPrompt).mockResolvedValueOnce(null); // cancelled
    await runEntryAction("rename", file, ctx());
    expect(iosRenameFile).toHaveBeenCalledTimes(1);
  });

  it("shares and toggles pins", async () => {
    await runEntryAction("share", file, ctx());
    expect(iosShareFile).toHaveBeenCalledWith("Ideas/note.md");
    const c = ctx();
    await runEntryAction("pin", file, c);
    expect(c.togglePin).toHaveBeenCalledWith("Ideas/note.md");
  });

  it("is a no-op when the sheet was cancelled", async () => {
    await runEntryAction(null, file, ctx());
    expect(iosShareFile).not.toHaveBeenCalled();
    expect(iosDeleteFile).not.toHaveBeenCalled();
  });
});

describe("confirmDelete", () => {
  it("names the folder's contents in the prompt so a folder delete is not mistaken for a file", async () => {
    vi.mocked(iosContextMenu).mockResolvedValueOnce(null);
    await confirmDelete(folder);
    expect(vi.mocked(iosContextMenu).mock.calls[0][0].title).toContain("everything in it");
  });
});

describe("presentEntryMenu", () => {
  it("passes the press point through for the iPad popover anchor", async () => {
    vi.mocked(iosContextMenu).mockResolvedValueOnce(null);
    await presentEntryMenu(file, { x: 12, y: 34 }, ctx());
    expect(vi.mocked(iosContextMenu).mock.calls[0][0].at).toEqual({ x: 12, y: 34 });
  });

  it("swallows a failed presentation rather than rejecting into the render", async () => {
    vi.mocked(iosContextMenu).mockRejectedValueOnce(new Error("no presenter"));
    await expect(presentEntryMenu(file, { x: 0, y: 0 }, ctx())).resolves.toBeUndefined();
  });
});
