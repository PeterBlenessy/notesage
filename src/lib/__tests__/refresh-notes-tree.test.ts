/**
 * @vitest-environment jsdom
 *
 * A failed Quick Notes listing used to blank the list (`setNotesTree([])`)
 * and say so only on the console (audit 2026-11-22 §10).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import "@/test/tauri-mock";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { refreshNotesTree } from "../refresh-notes-tree";

const ROOT = "/Users/me/Notesage";
const SHOWN = [{ name: "idea.md", path: `${ROOT}/idea.md`, is_directory: false, hidden: false }];

describe("refreshNotesTree", () => {
  let toastWarning: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    toastWarning = vi.mocked((await import("sonner")).toast.warning);
    toastWarning.mockClear();
    useSettingsStore.setState({ notesRootPath: ROOT, showHiddenFiles: false });
    useWorkspaceStore.setState({ notesTree: SHOWN });
    setMockInvokeHandler("path_exists", () => true);
  });

  it("keeps the notes already shown when the folder cannot be listed, and says so", async () => {
    setMockInvokeHandler("list_files_shallow", () => {
      throw new Error("Operation not permitted");
    });
    setMockInvokeHandler("list_directory", () => {
      throw new Error("Operation not permitted");
    });

    const count = await refreshNotesTree();

    expect(count).toBeNull();
    expect(useWorkspaceStore.getState().notesTree).toEqual(SHOWN);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning.mock.calls[0][1]).toMatchObject({ id: "quick-notes-unreadable" });
  });

  it("replaces the list when the listing succeeds", async () => {
    const fresh = [{ name: "new.md", path: `${ROOT}/new.md`, is_directory: false, hidden: false }];
    setMockInvokeHandler("list_files_shallow", () => fresh);
    expect(await refreshNotesTree()).toBe(1);
    expect(useWorkspaceStore.getState().notesTree).toEqual(fresh);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("shows an empty list for a notes root that does not exist yet", async () => {
    setMockInvokeHandler("path_exists", () => false);
    expect(await refreshNotesTree()).toBe(0);
    expect(useWorkspaceStore.getState().notesTree).toEqual([]);
    expect(toastWarning).not.toHaveBeenCalled();
  });
});
