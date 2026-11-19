// @vitest-environment jsdom

/**
 * A second Mac starting up after ANOTHER Mac moved the library into
 * Notesage's own iCloud folder.
 *
 * What it used to do: list each project at its old `iCloud Drive/Notesage`
 * path, find it gone, remove it with a "directory no longer exists" toast,
 * and then let the cross-device scan add back whatever the container held —
 * so this Mac ended up with the other Mac's project list, and removing a
 * project here only lasted until the next launch. With the container
 * unreadable it was worse: the sidebar came up empty with no explanation.
 *
 * Real workspace / editor / settings stores and the real scan; only the disk
 * (the Tauri boundary) is faked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import "@/test/tauri-mock";

const { disk, access } = vi.hoisted(() => ({
  /** Directories that exist, with their children's names. */
  disk: new Map<string, string[]>(),
  access: { value: "ready" as "ready" | "denied" | "missing" },
}));

const HOME = "/Users/w";
const ICLOUD = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`;
const OLD = `${ICLOUD}/Notesage`;
const NEW = `${HOME}/Library/Mobile Documents/iCloud~com~notesage~app/Documents`;

function listing(path: string) {
  const children = disk.get(path);
  if (!children) throw new Error(`No such directory: ${path}`);
  return children.map((name) => ({
    name,
    path: `${path}/${name}`,
    is_directory: disk.has(`${path}/${name}`),
    hidden: name.startsWith("."),
    children: undefined,
  }));
}

vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    setLogLevel: vi.fn(),
    getHomeDir: vi.fn(async () => HOME),
    listDirectory: vi.fn(async (p: string) => listing(p)),
    pathExists: vi.fn(async (p: string) => {
      if (disk.has(p)) return true;
      const parent = p.slice(0, p.lastIndexOf("/"));
      return (disk.get(parent) ?? []).includes(p.slice(parent.length + 1));
    }),
    createDirectory: vi.fn(async () => undefined),
    getICloudPath: vi.fn(async () => ICLOUD),
    getLibraryContainerPath: vi.fn(async () => (disk.has(NEW) ? NEW : null)),
    libraryContainerAccess: vi.fn(async () => access.value),
    readLibraryMarker: vi.fn(async () => ({
      version: 1,
      kind: "container",
      createdBy: "ios",
      createdAt: "2026-11-01T00:00:00Z",
      migratedFrom: "/Users/home/Library/Mobile Documents/com~apple~CloudDocs/Notesage",
    })),
    indexInit: vi.fn(async () => undefined),
    indexReset: vi.fn(async () => undefined),
    readFile: vi.fn(async (p: string) => {
      const parent = p.slice(0, p.lastIndexOf("/"));
      if (!(disk.get(parent) ?? []).includes(p.slice(parent.length + 1))) {
        throw new Error(`No such file: ${p}`);
      }
      return `# ${p.split("/").pop()}`;
    }),
    readBinaryFile: vi.fn(async () => []),
    writeFile: vi.fn(async () => undefined),
    watchDirectory: vi.fn(),
  },
}));

vi.mock("@/stores/editor-styles-store", () => ({
  useEditorStylesStore: { getState: () => ({ loadSettings: vi.fn(), loadSystemFonts: vi.fn() }) },
}));
vi.mock("@/stores/chat-store", () => ({
  useChatStore: { getState: () => ({ pruneStaleProjectPaths: vi.fn() }) },
}));
vi.mock("@/lib/refresh-notes-tree", () => ({ refreshNotesTree: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/rename-transaction", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rename-transaction")>()),
  recoverIncompleteTransactions: vi.fn().mockResolvedValue(undefined),
  executeRenameTransaction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
    setLogLevel: vi.fn(),
  };
});

import { toast } from "sonner";
import { reloadTrees } from "../useAppLifecycle";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";

function setDisk(dirs: Record<string, string[]>) {
  disk.clear();
  for (const [k, v] of Object.entries(dirs)) disk.set(k, v);
}

// `sonner` is mocked by `@/test/tauri-mock`.
const toastWarning = vi.mocked(toast.warning);

beforeEach(() => {
  toastWarning.mockClear();
  access.value = "ready";
  useSettingsStore.setState({
    notesRootPath: `${HOME}/Notesage`,
    icloudAvailable: false,
    icloudNotesagePath: null,
    libraryContainerDenied: false,
  });
  // This Mac's own setup before the other Mac migrated: two library
  // projects, one local one. It never had "Home Only", which the other Mac
  // added; and it had removed "Archive" from its sidebar earlier.
  useWorkspaceStore.setState({
    projects: [
      { path: `${OLD}/Work`, fileTree: [] },
      { path: `${OLD}/Recipes`, fileTree: [] },
      { path: `${HOME}/Code/local`, fileTree: [] },
    ],
    explorerFolders: [{ path: `${OLD}/Inbox`, fileTree: [] }],
    pinnedFiles: [`${OLD}/Work/plan.md`],
    recentProjects: [],
    dismissedLibraryProjects: [`${OLD}/Archive`],
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
});

describe("startup on a Mac that did not run the library move", () => {
  beforeEach(() => {
    setDisk({
      [`${HOME}/Notesage`]: [],
      [`${HOME}/Notesage/.notesage`]: [],
      [`${HOME}/Code/local`]: ["readme.md"],
      [OLD]: [],
      [NEW]: ["Work", "Recipes", "Inbox", "Home Only", "Archive"],
      [`${NEW}/Work`]: ["plan.md", ".notesage"],
      [`${NEW}/Work/.notesage`]: [],
      [`${NEW}/Recipes`]: ["pie.md", ".notesage"],
      [`${NEW}/Recipes/.notesage`]: [],
      [`${NEW}/Inbox`]: ["clip.md"],
      [`${NEW}/Home Only`]: [".notesage"],
      [`${NEW}/Home Only/.notesage`]: [],
      [`${NEW}/Archive`]: [".notesage"],
      [`${NEW}/Archive/.notesage`]: [],
    });
  });

  it("follows its own projects, folders and pins into the new library instead of removing them", async () => {
    await reloadTrees();

    const ws = useWorkspaceStore.getState();
    const paths = ws.projects.map((p) => p.path);
    expect(paths).toContain(`${NEW}/Work`);
    expect(paths).toContain(`${NEW}/Recipes`);
    expect(paths).toContain(`${HOME}/Code/local`);
    expect(paths.some((p) => p.startsWith(`${OLD}/`))).toBe(false);
    expect(ws.projects.find((p) => p.path === `${NEW}/Work`)?.fileTree.length).toBeGreaterThan(0);
    expect(ws.explorerFolders.map((f) => f.path)).toEqual([`${NEW}/Inbox`]);
    expect(ws.pinnedFiles).toEqual([`${NEW}/Work/plan.md`]);
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it("reopens the document that was open, from its new location, with its content", async () => {
    // It is restored at the very start of startup, from the OLD path — so
    // without a reload after the follow it came back empty.
    useEditorStore.setState({
      persistedTabs: [{ filePath: `${OLD}/Work/plan.md`, fileName: "plan.md" }],
      persistedActiveFilePath: `${OLD}/Work/plan.md`,
    });

    await reloadTrees();

    const editor = useEditorStore.getState();
    const open = editor.openDocuments.find((d) => d.id === editor.activeTabId);
    expect(open?.filePath).toBe(`${NEW}/Work/plan.md`);
    expect(open?.contentLoaded).toBe(true);
    expect(open?.content).toContain("plan");
    expect(editor.persistedActiveFilePath).toBe(`${NEW}/Work/plan.md`);
  });

  it("keeps a project removed on this Mac removed, even though the library holds it", async () => {
    await reloadTrees();

    const ws = useWorkspaceStore.getState();
    expect(ws.dismissedLibraryProjects).toEqual([`${NEW}/Archive`]);
    expect(ws.projects.map((p) => p.path)).not.toContain(`${NEW}/Archive`);
    // A project this Mac never had is still discovered, as before.
    expect(ws.projects.map((p) => p.path)).toContain(`${NEW}/Home Only`);
  });

  it("stays removed across launches", async () => {
    await reloadTrees();
    useWorkspaceStore.getState().removeProject(`${NEW}/Home Only`);
    useWorkspaceStore.getState().dismissLibraryProject(`${NEW}/Home Only`);

    await reloadTrees();

    expect(useWorkspaceStore.getState().projects.map((p) => p.path)).not.toContain(`${NEW}/Home Only`);
  });
});

describe("startup when macOS will not let Notesage read its iCloud folder", () => {
  beforeEach(() => {
    access.value = "denied";
    setDisk({
      [`${HOME}/Notesage`]: [],
      [`${HOME}/Notesage/.notesage`]: [],
      [`${HOME}/Code/local`]: ["readme.md"],
      [OLD]: [],
      // Visible on disk, but nothing inside can be read.
      [NEW]: [],
    });
  });

  it("keeps the library projects, says why, and does not pick the unreadable folder", async () => {
    await reloadTrees();

    const ws = useWorkspaceStore.getState();
    expect(ws.projects.map((p) => p.path)).toEqual([
      `${OLD}/Work`,
      `${OLD}/Recipes`,
      `${HOME}/Code/local`,
    ]);
    expect(ws.explorerFolders.map((f) => f.path)).toEqual([`${OLD}/Inbox`]);
    expect(useSettingsStore.getState().icloudNotesagePath).toBe(OLD);
    expect(useSettingsStore.getState().libraryContainerDenied).toBe(true);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(toastWarning.mock.calls[0][0]).toMatch(/Full Disk Access/);
  });

  it("still removes a genuinely missing project outside the library", async () => {
    useWorkspaceStore.setState({
      projects: [...useWorkspaceStore.getState().projects, { path: `${HOME}/Code/gone`, fileTree: [] }],
    });
    await reloadTrees();

    expect(useWorkspaceStore.getState().projects.map((p) => p.path)).not.toContain(`${HOME}/Code/gone`);
  });
});
