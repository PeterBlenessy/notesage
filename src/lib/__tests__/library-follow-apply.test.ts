/**
 * @vitest-environment jsdom
 *
 * The library follow re-points projects and folders at the new library. When
 * the new location could not be listed they were left with an EMPTY tree and
 * nothing ever refilled it (audit 2026-11-22 §10).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@/test/tauri-mock";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FOLLOW_TREE_RETRY_DELAYS_MS, followLibraryMove } from "../library-follow-apply";

const OLD = "/old/Notesage";
const NEW = "/new/Documents";
const TREE = [{ name: "a.md", path: `${NEW}/Work/a.md`, is_directory: false }];

describe("followLibraryMove — a new location that cannot be read yet", () => {
  let listable: boolean;
  let toastWarning: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    listable = false;
    toastWarning = vi.mocked((await import("sonner")).toast.warning);
    toastWarning.mockClear();
    useSettingsStore.setState({ notesRootPath: undefined, showHiddenFiles: false });
    useEditorStore.setState({ openDocuments: [], persistedTabs: [], recentFiles: [] });
    useWorkspaceStore.setState({
      projects: [{ path: `${OLD}/Work`, fileTree: [] }],
      explorerFolders: [{ path: `${OLD}/Shared`, fileTree: [] }],
      pinnedFiles: [],
      recentProjects: [],
      dismissedLibraryProjects: [],
    });
    // Gone from the old root, present in the new one: that is a move.
    setMockInvokeHandler("path_exists", (args) =>
      [`${NEW}/Work`, `${NEW}/Shared`].includes(String(args?.path)),
    );
    setMockInvokeHandler("write_file", () => undefined);
    setMockInvokeHandler("list_directory", (args) => {
      if (!listable) throw new Error("Resource deadlock avoided");
      return String(args?.path) === `${NEW}/Work` ? TREE : [];
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("still re-points, says so once, and fills the tree when a retry succeeds", async () => {
    const result = await followLibraryMove(OLD, NEW);

    expect(result.followed).toEqual([`${NEW}/Work`, `${NEW}/Shared`]);
    expect(useWorkspaceStore.getState().projects[0]).toEqual({ path: `${NEW}/Work`, fileTree: [] });
    // One toast for the whole follow, not one per unreadable entry.
    expect(toastWarning).toHaveBeenCalledTimes(1);

    listable = true;
    await vi.advanceTimersByTimeAsync(FOLLOW_TREE_RETRY_DELAYS_MS[0] + 10);

    expect(useWorkspaceStore.getState().projects[0].fileTree).toEqual(TREE);
  });

  it("keeps retrying while the location stays unreadable, then stops", async () => {
    let calls = 0;
    setMockInvokeHandler("list_directory", () => {
      calls += 1;
      throw new Error("Resource deadlock avoided");
    });
    await followLibraryMove(OLD, NEW);
    const afterFollow = calls;

    const total = FOLLOW_TREE_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0);
    await vi.advanceTimersByTimeAsync(total + 100);
    // Two entries (project + folder) × one read per retry round.
    expect(calls - afterFollow).toBe(2 * FOLLOW_TREE_RETRY_DELAYS_MS.length);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls - afterFollow).toBe(2 * FOLLOW_TREE_RETRY_DELAYS_MS.length);
  });

  it("shows no toast and schedules nothing when the new location reads fine", async () => {
    let calls = 0;
    setMockInvokeHandler("list_directory", (args) => {
      calls += 1;
      return String(args?.path) === `${NEW}/Work` ? TREE : [];
    });
    await followLibraryMove(OLD, NEW);
    expect(toastWarning).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().projects[0].fileTree).toEqual(TREE);
    const afterFollow = calls;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toBe(afterFollow);
  });
});
