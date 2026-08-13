// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileEntry } from "@/lib/tauri";

vi.mock("@/lib/ios-api", () => ({
  iosContextMenu: vi.fn(),
  iosEntryMenu: vi.fn(),
  iosDeleteFile: vi.fn(async () => {}),
  iosRenameFile: vi.fn(async () => "renamed.md"),
  iosShareFile: vi.fn(async () => {}),
  iosTextPrompt: vi.fn(async () => null),
}));

import {
  iosContextMenu,
  iosEntryMenu,
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
  it("offers share, pin and delete as the icon row, with rename beneath", () => {
    const items = entryMenuItems(file, ctx());
    expect(items.filter((i) => i.inline).map((i) => i.id)).toEqual(["share", "pin", "delete"]);
    expect(items.filter((i) => !i.inline).map((i) => i.id)).toEqual(["rename"]);
    expect(items.find((i) => i.id === "delete")?.destructive).toBe(true);
    // Every row must carry an SF Symbol — the menu is drawn natively and a
    // missing symbol renders as a blank slot.
    expect(items.every((i) => i.systemImage.length > 0)).toBe(true);
  });

  it("omits share for a folder — ios_share_file copies a single file", () => {
    expect(entryMenuItems(folder, ctx()).map((i) => i.id)).toEqual(["pin", "delete", "rename"]);
  });

  it("labels the pin row by current state", () => {
    expect(entryMenuItems(file, ctx()).find((i) => i.id === "pin")?.title).toBe("Pin");
    expect(entryMenuItems(file, ctx()).find((i) => i.id === "pin")?.systemImage).toBe("pin");
    expect(
      entryMenuItems(file, ctx({ isPinned: () => true })).find((i) => i.id === "pin")?.systemImage,
    ).toBe("pin.slash");
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
  const rect = { x: 12, y: 34, width: 300, height: 56 };

  it("passes the pressed rect through so the preview can morph out of the row", async () => {
    vi.mocked(iosEntryMenu).mockResolvedValueOnce(null);
    await presentEntryMenu(file, rect, ctx());
    expect(vi.mocked(iosEntryMenu).mock.calls[0][0].sourceRect).toEqual(rect);
  });

  it("gives a file a QuickLook preview path and a folder none", async () => {
    vi.mocked(iosEntryMenu).mockResolvedValue(null);
    await presentEntryMenu(file, rect, ctx());
    expect(vi.mocked(iosEntryMenu).mock.calls[0][0].previewRelPath).toBe("Ideas/note.md");
    await presentEntryMenu(folder, rect, ctx());
    expect(vi.mocked(iosEntryMenu).mock.calls[1][0].previewRelPath).toBeUndefined();
  });

  it("swallows a failed presentation rather than rejecting into the render", async () => {
    vi.mocked(iosEntryMenu).mockRejectedValueOnce(new Error("no presenter"));
    await expect(presentEntryMenu(file, rect, ctx())).resolves.toBeUndefined();
  });
});
