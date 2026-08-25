// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileEntry } from "@/lib/tauri";

vi.mock("@/lib/mobile-thumbnails", () => ({
  getThumbnail: vi.fn(async () => ({ kind: "markdown", html: "<p>rendered</p>" })),
  evictThumbnail: vi.fn(),
}));

vi.mock("@/lib/ios-api", () => ({
  iosContextMenu: vi.fn(),
  iosEntryMenu: vi.fn(),
  iosDeleteFile: vi.fn(async () => {}),
  iosListDirectory: vi.fn(async () => []),
  iosMoveFile: vi.fn(async (_p: string, dest: string) => `${dest}/note.md`),
  iosRenameFile: vi.fn(async () => "renamed.md"),
  iosShareFile: vi.fn(async () => {}),
  iosTextPrompt: vi.fn(async () => null),
}));

import {
  iosContextMenu,
  iosEntryMenu,
  iosDeleteFile,
  iosListDirectory,
  iosMoveFile,
  iosRenameFile,
  iosShareFile,
  iosTextPrompt,
} from "@/lib/ios-api";
import { evictThumbnail, getThumbnail } from "@/lib/mobile-thumbnails";
import {
  entryMenuItems,
  runEntryAction,
  presentEntryMenu,
  confirmDelete,
  pickDestinationFolder,
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
  it("offers share, pin and delete as the icon row, with rename and move beneath", () => {
    const items = entryMenuItems(file, ctx());
    expect(items.filter((i) => i.inline).map((i) => i.id)).toEqual(["share", "pin", "delete"]);
    expect(items.filter((i) => !i.inline).map((i) => i.id)).toEqual(["rename", "move"]);
    expect(items.find((i) => i.id === "delete")?.destructive).toBe(true);
    // Every row must carry an SF Symbol — the menu is drawn natively and a
    // missing symbol renders as a blank slot.
    expect(items.every((i) => i.systemImage.length > 0)).toBe(true);
  });

  it("omits share for a folder — ios_share_file copies a single file", () => {
    // Move is absent too: the native command is files-only.
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

  it("previews a note with the app's own render, not QuickLook's raw text", async () => {
    vi.mocked(iosEntryMenu).mockResolvedValueOnce(null);
    await presentEntryMenu(file, rect, ctx());
    expect(vi.mocked(iosEntryMenu).mock.calls[0][0].previewHtml).toBe("<p>rendered</p>");
  });

  it("falls back to the QuickLook path when the render is not markdown", async () => {
    vi.mocked(getThumbnail).mockResolvedValueOnce({ kind: "icon" });
    vi.mocked(iosEntryMenu).mockResolvedValueOnce(null);
    await presentEntryMenu(file, rect, ctx());
    expect(vi.mocked(iosEntryMenu).mock.calls[0][0].previewHtml).toBeUndefined();
    expect(vi.mocked(iosEntryMenu).mock.calls[0][0].previewRelPath).toBe("Ideas/note.md");
  });

  it("still presents the menu when rendering the preview fails", async () => {
    vi.mocked(getThumbnail).mockRejectedValueOnce(new Error("read failed"));
    vi.mocked(iosEntryMenu).mockResolvedValueOnce(null);
    await expect(presentEntryMenu(file, rect, ctx())).resolves.toBeUndefined();
    expect(iosEntryMenu).toHaveBeenCalled();
  });

  it("never renders a preview for a folder", async () => {
    vi.mocked(iosEntryMenu).mockResolvedValueOnce(null);
    await presentEntryMenu(folder, rect, ctx());
    expect(getThumbnail).not.toHaveBeenCalledWith(folder, expect.anything());
    expect(vi.mocked(iosEntryMenu).mock.calls[0][0].previewHtml).toBeUndefined();
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

describe("Move to… (#754)", () => {
  const dir = (name: string, path: string): FileEntry => ({
    name,
    path,
    is_directory: true,
    hidden: false,
  });

  beforeEach(() => vi.clearAllMocks());

  it("offers Move for a file", () => {
    const ids = entryMenuItems(file, ctx()).map((i) => i.id);
    expect(ids).toContain("move");
  });

  it("does not offer Move for a folder", () => {
    // The native command refuses directories, so the row's only outcome
    // would be an error toast.
    const ids = entryMenuItems(folder, ctx()).map((i) => i.id);
    expect(ids).not.toContain("move");
  });

  it("walks into a subfolder and back out again", async () => {
    vi.mocked(iosListDirectory).mockImplementation(async (p: string) =>
      p === "" ? [dir("Ideas", "Ideas")] : [dir("Deep", "Ideas/Deep")],
    );
    vi.mocked(iosContextMenu)
      .mockResolvedValueOnce("dir:Ideas") // root -> Ideas
      .mockResolvedValueOnce("__up__") // Ideas -> back to root
      .mockResolvedValueOnce("__here__"); // choose root

    await expect(pickDestinationFolder("")).resolves.toBe("");
  });

  it("returns null when the picker is cancelled", async () => {
    vi.mocked(iosContextMenu).mockResolvedValueOnce(null);
    await expect(pickDestinationFolder("")).resolves.toBeNull();
  });

  it("evicts the thumbnail and rewrites stored paths after a move", async () => {
    // Both are invisible until they go wrong: a stale thumbnail key makes the
    // moved card render someone else's image, and Recent/pins keep pointing
    // at a file that no longer exists.
    //
    // The picker opens in the file's OWN folder (Ideas), so getting somewhere
    // else takes a step up first — which is the real flow, not a detail.
    vi.mocked(iosListDirectory).mockResolvedValue([]);
    vi.mocked(iosContextMenu)
      .mockResolvedValueOnce("__up__")
      .mockResolvedValueOnce("__here__");
    vi.mocked(iosMoveFile).mockResolvedValueOnce("Archive/note.md");
    const onPathMoved = vi.fn();
    const onChanged = vi.fn();

    await runEntryAction("move", file, ctx({ onPathMoved, onChanged }));

    expect(iosMoveFile).toHaveBeenCalledWith("Ideas/note.md", "");
    expect(evictThumbnail).toHaveBeenCalledWith("Ideas/note.md");
    expect(onPathMoved).toHaveBeenCalledWith("Ideas/note.md", "Archive/note.md");
    expect(onChanged).toHaveBeenCalled();
  });

  it("does nothing when the chosen folder is the one it is already in", async () => {
    // The picker OPENS in the file's own folder, so "Move here" on the first
    // screen is exactly this case — it has to be a no-op rather than a dedupe
    // to `note-1.md`, or a stray tap silently forks the file.
    vi.mocked(iosListDirectory).mockResolvedValue([]);
    vi.mocked(iosContextMenu).mockResolvedValueOnce("__here__");

    await runEntryAction("move", file, ctx());

    expect(iosMoveFile).not.toHaveBeenCalled();
  });

  it("does not rewrite paths when the move fails", async () => {
    vi.mocked(iosListDirectory).mockResolvedValue([]);
    vi.mocked(iosContextMenu)
      .mockResolvedValueOnce("__up__")
      .mockResolvedValueOnce("__here__");
    vi.mocked(iosMoveFile).mockRejectedValueOnce(new Error("no such folder"));
    const onPathMoved = vi.fn();

    await runEntryAction("move", file, ctx({ onPathMoved }));

    expect(onPathMoved).not.toHaveBeenCalled();
    expect(evictThumbnail).not.toHaveBeenCalled();
  });
});
