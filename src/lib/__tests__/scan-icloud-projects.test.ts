// @vitest-environment jsdom

/**
 * The launch-time library scan (performance review 2026-11, S-3 and S-4).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import "@/test/tauri-mock";

vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    listDirectory: vi.fn(),
    listFilesShallow: vi.fn(),
    pathExists: vi.fn(),
  },
}));

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
  };
});

import { scanICloudForProjects, forgetReservedLibraryFolders } from "../scan-icloud-projects";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { tauriApi, type FileEntry } from "@/lib/tauri";

const api = vi.mocked(tauriApi);

const ROOT = "/Users/w/Library/Mobile Documents/iCloud~com~notesage~app/Documents";

const file = (dir: string, name: string): FileEntry => ({
  name,
  path: `${dir}/${name}`,
  is_directory: false,
  hidden: false,
});
const folder = (dir: string, name: string, children: FileEntry[]): FileEntry => ({
  name,
  path: `${dir}/${name}`,
  is_directory: true,
  hidden: false,
  children,
});

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState({
    projects: [{ path: `${ROOT}/Known`, fileTree: [] }],
    explorerFolders: [],
    recentProjects: [],
    dismissedLibraryProjects: [],
  });
  api.pathExists.mockResolvedValue(true);
  api.listDirectory.mockResolvedValue([
    folder(ROOT, "Inbox", [file(`${ROOT}/Inbox`, "clip.html")]),
    folder(ROOT, "Known", []),
    folder(ROOT, "Recordings", []),
    folder(ROOT, "Travel", [file(`${ROOT}/Travel`, "rome.md")]),
    file(ROOT, "loose.md"),
  ]);
});

describe("scanICloudForProjects", () => {
  it("adds a new project using the tree the root listing already returned: one listing in all", async () => {
    const discovered = await scanICloudForProjects(ROOT);

    expect(discovered).toBe(true);
    const travel = useWorkspaceStore.getState().projects.find((p) => p.path === `${ROOT}/Travel`);
    expect(travel?.fileTree.map((e) => e.name)).toEqual(["rome.md"]);
    // The library root, once. Not once more per discovered project.
    expect(api.listDirectory).toHaveBeenCalledTimes(1);
    expect(api.listDirectory.mock.calls[0][0]).toBe(ROOT);
  });

  it("never adds the Inbox or Recordings folder, and does not probe them", async () => {
    await scanICloudForProjects(ROOT);

    const paths = useWorkspaceStore.getState().projects.map((p) => p.path);
    expect(paths).toEqual([`${ROOT}/Known`, `${ROOT}/Travel`]);
    expect(api.pathExists.mock.calls.map((c) => c[0])).toEqual([`${ROOT}/Travel/.notesage`]);
  });

  it("still lists a project itself when the root listing did not carry its children", async () => {
    api.listDirectory.mockReset();
    api.listDirectory.mockImplementation(async (path: string) =>
      path === ROOT
        ? [{ name: "Travel", path: `${ROOT}/Travel`, is_directory: true, hidden: false }]
        : [file(`${ROOT}/Travel`, "rome.md")],
    );

    await scanICloudForProjects(ROOT);

    const travel = useWorkspaceStore.getState().projects.find((p) => p.path === `${ROOT}/Travel`);
    expect(travel?.fileTree.map((e) => e.name)).toEqual(["rome.md"]);
  });

  it("skips a project folder the root listing could not read", async () => {
    api.listDirectory.mockResolvedValue([
      { ...folder(ROOT, "Travel", []), unreadable: true },
    ]);

    expect(await scanICloudForProjects(ROOT)).toBe(false);
    expect(useWorkspaceStore.getState().projects.map((p) => p.path)).toEqual([`${ROOT}/Known`]);
  });
});

describe("forgetReservedLibraryFolders", () => {
  it("drops a registered Inbox or Recordings folder without recording a removal", () => {
    useWorkspaceStore.setState({
      projects: [
        { path: `${ROOT}/Known`, fileTree: [] },
        { path: `${ROOT}/Inbox`, fileTree: [] },
      ],
      explorerFolders: [
        { path: `${ROOT}/Recordings`, fileTree: [] },
        { path: "/Users/w/Elsewhere/Inbox", fileTree: [] },
      ],
    });

    const dropped = forgetReservedLibraryFolders([ROOT, null, undefined]);

    expect(dropped).toEqual([`${ROOT}/Inbox`, `${ROOT}/Recordings`]);
    const ws = useWorkspaceStore.getState();
    expect(ws.projects.map((p) => p.path)).toEqual([`${ROOT}/Known`]);
    // A folder merely CALLED Inbox, outside the library root, is the person's own.
    expect(ws.explorerFolders.map((f) => f.path)).toEqual(["/Users/w/Elsewhere/Inbox"]);
    expect(ws.dismissedLibraryProjects).toEqual([]);
    expect(ws.recentProjects).toEqual([]);
    // No IPC at all: nothing on disk is read, let alone changed.
    expect(api.listDirectory).not.toHaveBeenCalled();
    expect(api.pathExists).not.toHaveBeenCalled();
  });

  it("leaves the store untouched when there is nothing to drop", () => {
    const before = useWorkspaceStore.getState().projects;

    expect(forgetReservedLibraryFolders([ROOT])).toEqual([]);

    expect(useWorkspaceStore.getState().projects).toBe(before);
  });
});
