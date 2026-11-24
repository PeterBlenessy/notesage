// @vitest-environment jsdom

/**
 * What startup costs, pinned (performance review 2026-11, "Startup passes").
 *
 *  - S-1: the UI is ready (`startupReady`) while `index_init` is still
 *    running; a separate signal (`indexReady` + `notesage:index-ready`) says
 *    when the index pass has settled, whether or not it succeeded.
 *  - S-3: the "does the old CloudDocs library hold anything" check answers
 *    from one shallow listing when it can.
 *  - S-4: the Inbox and Recordings folders are never projects, and one that
 *    an earlier version registered is dropped without touching the disk.
 *
 * Real workspace / editor / settings stores and the real scan; only the disk
 * (the Tauri boundary) is faked — same harness as
 * `reloadTrees.library-follow.test.ts`.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import "@/test/tauri-mock";

const { disk, indexInit, mutations } = vi.hoisted(() => ({
  /** Directories that exist, with their children's names. */
  disk: new Map<string, string[]>(),
  /** Replaced per test to hold `index_init` open or make it fail. */
  indexInit: { impl: (async () => undefined) as (projectPath?: string) => Promise<unknown> },
  /** Every call that would change the disk. */
  mutations: [] as string[],
}));

const HOME = "/Users/w";
const ICLOUD = `${HOME}/Library/Mobile Documents/com~apple~CloudDocs`;
const OLD = `${ICLOUD}/Notesage`;
const NEW = `${HOME}/Library/Mobile Documents/iCloud~com~notesage~app/Documents`;

function entry(path: string, name: string, recursive: boolean): {
  name: string;
  path: string;
  is_directory: boolean;
  hidden: boolean;
  children?: unknown[];
} {
  const full = `${path}/${name}`;
  const isDir = disk.has(full);
  return {
    name,
    path: full,
    is_directory: isDir,
    hidden: name.startsWith("."),
    children: isDir && recursive ? listing(full, true) : undefined,
  };
}

/** `list_directory`: recursive, files and folders, hidden entries left out. */
function listing(path: string, recursive = true) {
  const children = disk.get(path);
  if (!children) throw new Error(`No such directory: ${path}`);
  return children.filter((n) => !n.startsWith(".")).map((name) => entry(path, name, recursive));
}

/** `list_files_shallow`: one level, FILES ONLY, hidden entries left out. */
function shallowFiles(path: string) {
  const children = disk.get(path);
  if (!children) throw new Error(`Path does not exist: ${path}`);
  return children
    .filter((n) => !n.startsWith(".") && !disk.has(`${path}/${n}`))
    .map((name) => entry(path, name, false));
}

vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    setLogLevel: vi.fn(),
    getHomeDir: vi.fn(async () => HOME),
    listDirectory: vi.fn(async (p: string) => listing(p)),
    listFilesShallow: vi.fn(async (p: string) => shallowFiles(p)),
    pathExists: vi.fn(async (p: string) => {
      if (disk.has(p)) return true;
      const parent = p.slice(0, p.lastIndexOf("/"));
      return (disk.get(parent) ?? []).includes(p.slice(parent.length + 1));
    }),
    createDirectory: vi.fn(async (p: string) => { mutations.push(`createDirectory ${p}`); }),
    getICloudPath: vi.fn(async () => ICLOUD),
    getLibraryContainerPath: vi.fn(async () => (disk.has(NEW) ? NEW : null)),
    libraryContainerAccess: vi.fn(async () => "ready"),
    icloudEnsureDownloaded: vi.fn(async () => "downloading"),
    readLibraryMarker: vi.fn(async () => ({
      version: 1,
      kind: "container",
      createdBy: "ios",
      createdAt: "2026-11-01T00:00:00Z",
      migratedFrom: "/Users/home/Library/Mobile Documents/com~apple~CloudDocs/Notesage",
    })),
    indexInit: vi.fn((projectPath?: string) => indexInit.impl(projectPath)),
    indexOpen: vi.fn(async (_projectPaths: string[]) => undefined),
    indexReset: vi.fn(async () => undefined),
    readFile: vi.fn(async (p: string) => `# ${p.split("/").pop()}`),
    readBinaryFile: vi.fn(async () => []),
    writeFile: vi.fn(async (p: string) => { mutations.push(`writeFile ${p}`); }),
    deletePath: vi.fn(async (p: string) => { mutations.push(`deletePath ${p}`); }),
    trashPath: vi.fn(async (p: string) => { mutations.push(`trashPath ${p}`); }),
    renamePath: vi.fn(async (p: string) => { mutations.push(`renamePath ${p}`); }),
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
import { reloadTrees, INDEX_READY_EVENT } from "../useAppLifecycle";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useEditorStore } from "@/stores/editor-store";
import { tauriApi } from "@/lib/tauri";
import { log } from "@/lib/logger";

const api = vi.mocked(tauriApi);
const perf = vi.mocked(log.perf);
// `sonner` is mocked by `@/test/tauri-mock`.
const toastWarning = vi.mocked(toast.warning);

function setDisk(dirs: Record<string, string[]>) {
  disk.clear();
  for (const [k, v] of Object.entries(dirs)) disk.set(k, v);
}

/** Let fire-and-forget work that is not held open run to completion. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function perfLines(message: string) {
  return perf.mock.calls.filter((c) => c[1] === message);
}

let indexReadyEvents = 0;
const onIndexReady = () => { indexReadyEvents += 1; };

beforeEach(() => {
  vi.clearAllMocks();
  mutations.length = 0;
  indexInit.impl = async () => undefined;
  indexReadyEvents = 0;
  window.removeEventListener(INDEX_READY_EVENT, onIndexReady);
  window.addEventListener(INDEX_READY_EVENT, onIndexReady);
  useSettingsStore.setState({
    notesRootPath: `${HOME}/Notesage`,
    icloudAvailable: false,
    icloudNotesagePath: null,
    libraryContainerDenied: false,
    startupReady: false,
    indexReady: false,
  });
  useWorkspaceStore.setState({
    projects: [
      { path: `${NEW}/Work`, fileTree: [] },
      { path: `${NEW}/Recipes`, fileTree: [] },
    ],
    explorerFolders: [],
    pinnedFiles: [],
    recentProjects: [],
    dismissedLibraryProjects: [],
  });
  useEditorStore.setState({
    openDocuments: [],
    activeTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
  setDisk({
    [`${HOME}/Notesage`]: [],
    [`${HOME}/Notesage/.notesage`]: [],
    [NEW]: ["Work", "Recipes", "Inbox", "Recordings"],
    [`${NEW}/Work`]: ["plan.md", ".notesage"],
    [`${NEW}/Work/.notesage`]: [],
    [`${NEW}/Recipes`]: ["pie.md", ".notesage"],
    [`${NEW}/Recipes/.notesage`]: [],
    // The Inbox keeps its reading-progress sidecar in `.notesage/`, which is
    // exactly what project discovery looks for.
    [`${NEW}/Inbox`]: ["clip.html", ".notesage"],
    [`${NEW}/Inbox/.notesage`]: ["reading-progress.json", "project.json"],
    [`${NEW}/Recordings`]: [".notesage"],
    [`${NEW}/Recordings/.notesage`]: [],
  });
});

describe("S-1: startup does not wait for the index", () => {
  it("sets startupReady while index_init is still pending, and signals index-ready when it resolves", async () => {
    const release: Array<() => void> = [];
    indexInit.impl = () => new Promise<void>((resolve) => { release.push(resolve); });

    await reloadTrees();

    // The UI is ready; the global index_init has been issued and is open.
    expect(useSettingsStore.getState().startupReady).toBe(true);
    expect(api.indexInit).toHaveBeenCalledTimes(1);
    expect(api.indexInit).toHaveBeenCalledWith(undefined);
    // Every project's database was opened (not indexed) before the UI, and
    // so the watchers, came up: otherwise a watcher event for a project that
    // is still waiting its turn is indexed into the global database.
    expect(api.indexOpen).toHaveBeenCalledTimes(1);
    expect(api.indexOpen).toHaveBeenCalledWith([`${NEW}/Work`, `${NEW}/Recipes`]);
    expect(api.indexOpen.mock.invocationCallOrder[0]).toBeLessThan(api.indexInit.mock.invocationCallOrder[0]);
    expect(useSettingsStore.getState().indexReady).toBe(false);
    expect(indexReadyEvents).toBe(0);
    expect(perfLines("ready")).toHaveLength(1);
    expect(perfLines("index ready")).toHaveLength(0);

    // Global done → every project is initialised, still in the background.
    release.shift()!();
    await settle();
    expect(api.indexInit.mock.calls.map((c) => c[0])).toEqual([
      undefined,
      `${NEW}/Work`,
      `${NEW}/Recipes`,
    ]);
    expect(useSettingsStore.getState().indexReady).toBe(false);

    for (const r of release.splice(0)) r();
    await settle();

    expect(useSettingsStore.getState().indexReady).toBe(true);
    expect(indexReadyEvents).toBe(1);
    // One line each, and `index ready` carries its own duration.
    expect(perfLines("index init")).toHaveLength(2);
    expect(perfLines("index init total")).toHaveLength(1);
    const [indexReady] = perfLines("index ready");
    expect(indexReady[2]).toMatchObject({ ok: true });
    expect(indexReady[2]).toHaveProperty("ms");
    expect(indexReady[2]).toHaveProperty("sinceStartMs");
  });

  it("is still ready, logs the failure and signals index-ready when index_init rejects", async () => {
    indexInit.impl = async () => { throw new Error("database disk image is malformed"); };

    await reloadTrees();
    expect(useSettingsStore.getState().startupReady).toBe(true);

    await settle();

    // Recovery was attempted for the global DB and each project, and failed.
    expect(api.indexReset).toHaveBeenCalledTimes(3);
    expect(vi.mocked(log.warn).mock.calls.some((c) => /Index init failed/.test(String(c[1])))).toBe(true);
    expect(vi.mocked(log.error).mock.calls.some((c) => /Index recovery failed/.test(String(c[1])))).toBe(true);
    expect(useSettingsStore.getState().indexReady).toBe(true);
    expect(indexReadyEvents).toBe(1);
    expect(perfLines("index ready")).toHaveLength(1);
  });

  it("signals index-ready even when startup fails before the index pass begins", async () => {
    api.getICloudPath.mockResolvedValueOnce(ICLOUD);
    const { refreshNotesTree } = await import("@/lib/refresh-notes-tree");
    vi.mocked(refreshNotesTree).mockRejectedValueOnce(new Error("boom"));

    await expect(reloadTrees()).rejects.toThrow("boom");

    expect(api.indexInit).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().indexReady).toBe(true);
    expect(indexReadyEvents).toBe(1);
  });
});

describe("S-3: the old CloudDocs library is checked for content without walking it", () => {
  it("answers from the shallow listing when a top-level file is there", async () => {
    disk.set(OLD, ["leftover.md", "Old Project"]);
    disk.set(`${OLD}/Old Project`, ["a.md", "b.md"]);

    await reloadTrees();

    expect(api.listFilesShallow).toHaveBeenCalledWith(OLD);
    expect(api.listDirectory.mock.calls.map((c) => c[0])).not.toContain(OLD);
  });

  it("falls back to the full listing when the shallow one shows no files, because it cannot see folders", async () => {
    disk.set(OLD, ["Old Project"]);
    disk.set(`${OLD}/Old Project`, ["a.md"]);

    await reloadTrees();

    expect(api.listFilesShallow).toHaveBeenCalledWith(OLD);
    expect(api.listDirectory.mock.calls.map((c) => c[0])).toContain(OLD);
  });
});

describe("S-4: the Inbox and Recordings folders are not projects", () => {
  it("does not add them, although both have a .notesage folder", async () => {
    await reloadTrees();

    // The scan ran, against the library that holds them.
    expect(useSettingsStore.getState().icloudNotesagePath).toBe(NEW);
    expect(api.listDirectory.mock.calls.map((c) => c[0])).toContain(NEW);
    const paths = useWorkspaceStore.getState().projects.map((p) => p.path);
    expect(paths).toEqual([`${NEW}/Work`, `${NEW}/Recipes`]);
    // Not even probed for metadata.
    const probed = api.pathExists.mock.calls.map((c) => c[0]);
    expect(probed).not.toContain(`${NEW}/Inbox/.notesage`);
    expect(probed).not.toContain(`${NEW}/Recordings/.notesage`);
  });

  it("silently drops an Inbox that is already registered, and touches nothing on disk", async () => {
    useWorkspaceStore.setState({
      projects: [
        { path: `${NEW}/Work`, fileTree: [] },
        { path: `${NEW}/Inbox`, fileTree: [] },
        { path: `${NEW}/Recipes`, fileTree: [] },
      ],
      explorerFolders: [{ path: `${NEW}/Recordings`, fileTree: [] }],
    });

    await reloadTrees();
    await settle();

    const ws = useWorkspaceStore.getState();
    expect(ws.projects.map((p) => p.path)).toEqual([`${NEW}/Work`, `${NEW}/Recipes`]);
    expect(ws.explorerFolders).toEqual([]);
    // Not "removed by the person": neither dismissed nor offered as recent.
    expect(ws.dismissedLibraryProjects).toEqual([]);
    expect(ws.recentProjects).toEqual([]);
    expect(toastWarning).not.toHaveBeenCalled();
    expect(vi.mocked(log.info).mock.calls.some((c) => String(c[1]).includes(`${NEW}/Inbox`))).toBe(true);
    // Never indexed as a project either.
    expect(api.indexInit.mock.calls.map((c) => c[0])).not.toContain(`${NEW}/Inbox`);
    // Files are left alone, `Inbox/.notesage/project.json` included.
    expect(mutations.filter((m) => m.includes("/Inbox") || m.includes("/Recordings"))).toEqual([]);
    expect(disk.get(`${NEW}/Inbox/.notesage`)).toContain("project.json");
  });

  it("stays dropped on the next launch", async () => {
    useWorkspaceStore.setState({
      projects: [{ path: `${NEW}/Inbox`, fileTree: [] }],
    });

    await reloadTrees();
    await reloadTrees();

    expect(useWorkspaceStore.getState().projects.map((p) => p.path)).not.toContain(`${NEW}/Inbox`);
  });
});
