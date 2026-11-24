// @vitest-environment jsdom

/**
 * Render-count bench for a tree refresh (perf review F-1).
 *
 * A watcher event relists a whole project and hands the fresh listing to
 * `updateProjectTree`. Before, every `FileEntry` in it was a new object, so
 * every visible row of that project re-rendered for a change in one folder,
 * and every row's indicators re-rendered again because they subscribed to
 * `projects`. Now a refresh re-renders the rows on the path to the change and
 * nothing else; a refresh that found nothing new re-renders nothing.
 *
 * This counts renders, not milliseconds: the count is the property that holds
 * on any machine. The probe is `useFileTreeItemState`, which the real
 * `SidebarRowIndicators` calls exactly once per render, so it sees both a row
 * re-rendering (the indicators render with it) and the indicators
 * re-rendering on their own.
 *
 * A project row (`ChildRow`) calls `useMoveIntoFolder` for drops from the
 * Inbox. That used to go through `useInboxActions`, which subscribes to
 * `projects`, so every visible row rendered once per tree change whatever
 * its props did. Rows now use `useInboxFileTo`, which subscribes to nothing.
 * The first case below runs with a stand-in for `useInboxActions`, the second
 * with the real module; both assert zero.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithProviders } from "@/test/component-harness";
import { registerDefaultHandlers } from "@/test/tauri-mock";
import { ProjectsSection } from "@/components/sidebar/quiet/ProjectsSection";
import { FoldersSection } from "@/components/sidebar/quiet/FoldersSection";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { FileEntry } from "@/lib/tauri";

const renders = new Map<string, number>();
/** Constant for the life of a mounted tree, so the hook order never changes. */
const inboxHook = { real: false };

vi.mock("@/hooks/useFileTreeItemState", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useFileTreeItemState")>(
    "@/hooks/useFileTreeItemState",
  );
  return {
    ...actual,
    useFileTreeItemState: (...args: Parameters<typeof actual.useFileTreeItemState>) => {
      renders.set(args[0], (renders.get(args[0]) ?? 0) + 1);
      return actual.useFileTreeItemState(...args);
    },
  };
});

vi.mock("@/components/inbox/useInboxActions", async () => {
  const actual = await vi.importActual<typeof import("@/components/inbox/useInboxActions")>(
    "@/components/inbox/useInboxActions",
  );
  const noop = async () => [];
  const standIn = {
    open: noop,
    fileTo: noop,
    fileToLast: noop,
    togglePin: () => {},
    trash: noop,
    openOriginal: noop,
    projects: [],
    pinnedFiles: [],
  };
  return {
    ...actual,
    useInboxActions: () => (inboxHook.real ? actual.useInboxActions() : standIn),
  };
});

vi.mock("@/hooks/useFileOperations", () => {
  const operations = {
    openFile: vi.fn(),
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  };
  return { useFileOperations: () => operations };
});

// ---------------------------------------------------------------------------
// Dataset: one root with three folders of FILES_PER_FOLDER files each plus
// loose files at its top level, and a second root that is never touched.
// ---------------------------------------------------------------------------

const FILES_PER_FOLDER = 60;
const TOP_LEVEL_FILES = 20;
const FOLDERS = ["archive", "notes", "projects"];

function file(path: string): FileEntry {
  return { name: path.split("/").pop() as string, path, is_directory: false, hidden: false };
}

/** A listing as the backend returns it: all-new objects on every call. */
function listing(root: string, extra: string[] = []): FileEntry[] {
  const folders = FOLDERS.map((name): FileEntry => {
    const dir = `${root}/${name}`;
    const children = Array.from({ length: FILES_PER_FOLDER }, (_, i) =>
      file(`${dir}/${name}-${String(i).padStart(3, "0")}.md`),
    );
    for (const path of extra) {
      if (path.startsWith(`${dir}/`)) children.push(file(path));
    }
    return { name, path: dir, is_directory: true, hidden: false, children };
  });
  const loose = Array.from({ length: TOP_LEVEL_FILES }, (_, i) =>
    file(`${root}/top-${String(i).padStart(3, "0")}.md`),
  );
  return [...folders, ...loose];
}

const ALPHA = "/Users/me/Library/Notesage/alpha";
const BETA = "/Users/me/Library/Notesage/beta";
const CHANGED_DIR = `${ALPHA}/notes`;
const NEW_FILE = `${CHANGED_DIR}/zz-new.md`;

/** Visible rows per expanded root: 3 folders + their 180 files + 20 loose files. */
const VISIBLE_ROWS_PER_ROOT = FOLDERS.length * (1 + FILES_PER_FOLDER) + TOP_LEVEL_FILES;

/** Open every collapsed row (roots, then their folders) until the whole tree is on screen. */
function expandEverything(): void {
  for (let pass = 0; pass < 50; pass++) {
    const collapsed = screen
      .getAllByRole("treeitem")
      .find((el) => el.getAttribute("aria-expanded") === "false");
    if (!collapsed) return;
    fireEvent.keyDown(collapsed, { key: "ArrowRight" });
  }
  throw new Error("tree did not finish expanding");
}

interface Measurement {
  /** Rows on screen below the roots. */
  mounted: number;
  /** Row renders caused by a refresh whose listing is identical. */
  unchanged: number;
  /** After one new file: rows rendered that are not a root row, the changed folder, or in it. */
  outside: Array<[string, number]>;
  /** After one new file: root rows, the changed folder row and rows in it that rendered. */
  onPath: number;
}

function measure(update: (tree: FileEntry[]) => void, roots: string[]): Measurement {
  expandEverything();
  const mounted = [...renders.keys()].filter((p) => !roots.includes(p)).length;

  renders.clear();
  act(() => update(listing(ALPHA)));
  let unchanged = 0;
  for (const count of renders.values()) unchanged += count;

  renders.clear();
  act(() => update(listing(ALPHA, [NEW_FILE])));
  const all = [...renders.entries()];
  // The root rows themselves (one per project or folder, a dozen in a real
  // library) are rendered by the section and re-render with it; the rows
  // that scale with the library are the ones below them.
  const outside = all.filter(
    ([path]) => !roots.includes(path) && path !== CHANGED_DIR && !path.startsWith(`${CHANGED_DIR}/`),
  );
  const onPath = all.length - outside.length;
  return { mounted, unchanged, outside, onPath };
}

function report(name: string, m: Measurement): void {
  console.log(
    `[perf] tree-refresh rows (${name}): mounted=${m.mounted} unchanged-refresh=${m.unchanged} ` +
      `one-new-file: outside=${m.outside.length} on-path=${m.onPath}`,
  );
}

function mountProjects(): Measurement {
  useWorkspaceStore.setState({
    projects: [
      { path: ALPHA, fileTree: listing(ALPHA) },
      { path: BETA, fileTree: listing(BETA) },
    ],
  });
  renderWithProviders(<ProjectsSection />);
  return measure(
    (tree) => useWorkspaceStore.getState().updateProjectTree(ALPHA, tree),
    [ALPHA, BETA],
  );
}

beforeEach(() => {
  registerDefaultHandlers();
  renders.clear();
  inboxHook.real = false;
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    recentFiles: [],
    persistedTabs: [],
  });
  useSettingsStore.setState({ showHiddenFiles: false, gitEnabled: false });
});

describe("tree refresh: sidebar row renders", () => {
  it("ProjectsSection: a new file re-renders 0 rows outside the changed folder", () => {
    const m = mountProjects();
    report("projects", m);

    // Both projects fully open: the whole tree is on screen.
    expect(m.mounted).toBe(VISIBLE_ROWS_PER_ROOT * 2);
    expect(screen.getByRole("treeitem", { name: /open file zz-new\.md/i })).toBeTruthy();
    expect(m.unchanged).toBe(0);
    expect(m.outside).toEqual([]);
    // The two project rows, the folder row and the new file's row. The 60
    // files already in the folder keep their entries and do not render.
    expect(m.onPath).toBeLessThanOrEqual(4);
  });

  it("ProjectsSection with the real Inbox hook: also 0 rows outside the changed folder", () => {
    inboxHook.real = true;
    const m = mountProjects();
    report("projects, real useInboxActions", m);

    expect(m.unchanged).toBe(0);
    // Rows take filing from `useInboxFileTo`, which subscribes to nothing, so
    // the real hook now costs what the stand-in does.
    expect(m.outside).toEqual([]);
  });

  it("FoldersSection: a new file re-renders 0 rows outside the changed folder", () => {
    useWorkspaceStore.setState({
      explorerFolders: [{ path: ALPHA, fileTree: listing(ALPHA) }],
    });
    renderWithProviders(<FoldersSection />);
    const m = measure(
      (tree) => useWorkspaceStore.getState().updateExplorerTree(ALPHA, tree),
      [ALPHA],
    );
    report("folders", m);

    expect(m.mounted).toBe(VISIBLE_ROWS_PER_ROOT);
    expect(screen.getByRole("treeitem", { name: /open file zz-new\.md/i })).toBeTruthy();
    expect(m.unchanged).toBe(0);
    expect(m.outside).toEqual([]);
    expect(m.onPath).toBeLessThanOrEqual(3);
  });
});
