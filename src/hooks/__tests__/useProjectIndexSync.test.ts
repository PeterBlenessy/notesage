// @vitest-environment jsdom

/**
 * A project that joins the workspace while the app is running gets its index
 * opened and built then, not at the next launch.
 *
 * Before, `index_init` ran at startup only: a project created, opened,
 * discovered, renamed or moved afterwards had nothing in search, tags,
 * mentions, tasks or backlinks until a restart, and the watcher indexed its
 * files into the global database meanwhile.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import "@/test/tauri-mock";

const { calls, indexInit } = vi.hoisted(() => ({
  /** `open:<paths>` / `init:<path>` / `reset:<path>`, in call order. */
  calls: [] as string[],
  /** Replaced per test to hold `index_init` open or make it fail. */
  indexInit: { impl: (async () => undefined) as (projectPath?: string) => Promise<unknown> },
}));

vi.mock("@/lib/tauri", () => ({
  tauriApi: {
    indexOpen: vi.fn(async (paths: string[]) => {
      calls.push(`open:${paths.join(",")}`);
    }),
    indexInit: vi.fn((projectPath?: string) => {
      calls.push(`init:${projectPath ?? "global"}`);
      return indexInit.impl(projectPath);
    }),
    indexReset: vi.fn(async (projectPath?: string) => {
      calls.push(`reset:${projectPath ?? "global"}`);
    }),
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/lib/logger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger")>();
  return {
    ...actual,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), perf: vi.fn() },
  };
});

import { useProjectIndexSync } from "../useProjectIndexSync";
import { ensureProjectIndex, resetProjectIndexSyncForTests } from "@/lib/project-index-sync";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSettingsStore } from "@/stores/settings-store";
import { tauriApi } from "@/lib/tauri";
import { toast } from "sonner";

const api = vi.mocked(tauriApi);

const LIB = "/lib";
const A = `${LIB}/Alpha`;
const B = `${LIB}/Beta`;
const C = `${LIB}/Gamma`;

function setProjects(...paths: string[]) {
  useWorkspaceStore.setState({ projects: paths.map((path) => ({ path, fileTree: [] })) });
}

/** Let the effect's promise chain (open → init → bookkeeping) run out. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

const initsFor = (path: string) => calls.filter((c) => c === `init:${path}`).length;

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  indexInit.impl = async () => undefined;
  resetProjectIndexSyncForTests();
  useSettingsStore.setState({
    notesRootPath: LIB,
    icloudNotesagePath: null,
    startupReady: false,
    indexReady: false,
  });
  setProjects(A);
});

/** Mount with startup finished and project A already known. */
async function mountAfterStartup() {
  const view = renderHook(() => useProjectIndexSync());
  act(() => useSettingsStore.setState({ startupReady: true }));
  await settle();
  return view;
}

describe("useProjectIndexSync", () => {
  it("leaves the projects known at startup to the startup pass", async () => {
    await mountAfterStartup();

    expect(calls).toEqual([]);
  });

  it("does nothing before startup has finished", async () => {
    renderHook(() => useProjectIndexSync());
    act(() => setProjects(A, B));
    await settle();

    expect(calls).toEqual([]);
  });

  it("opens, then indexes, exactly the project that was added, once", async () => {
    await mountAfterStartup();

    act(() => setProjects(A, B));
    await settle();

    // Opened first, so the watcher's events are routed to the project's own
    // database while the pass is still to come.
    expect(calls).toEqual([`open:${B}`, `init:${B}`]);
  });

  it("does not index again when only a tree's contents change", async () => {
    await mountAfterStartup();
    act(() => setProjects(A, B));
    await settle();
    calls.length = 0;

    // A file event replaces `projects` with the same paths.
    act(() => setProjects(A, B));
    act(() => setProjects(A, B));
    await settle();

    expect(calls).toEqual([]);
  });

  it("indexes each of two projects added in quick succession once", async () => {
    const release: Array<() => void> = [];
    indexInit.impl = () => new Promise<void>((resolve) => { release.push(resolve); });
    await mountAfterStartup();

    act(() => setProjects(A, B));
    act(() => setProjects(A, B, C));
    await settle();

    expect(initsFor(B)).toBe(1);
    expect(initsFor(C)).toBe(1);

    for (const r of release.splice(0)) r();
    await settle();
    expect(calls.filter((c) => c.startsWith("init:"))).toEqual([`init:${B}`, `init:${C}`]);
  });

  it("indexes several projects that appear at once, opening them in one call", async () => {
    await mountAfterStartup();

    act(() => setProjects(A, B, C));
    await settle();

    expect(calls).toEqual([`open:${B},${C}`, `init:${B}`, `init:${C}`]);
  });

  it("shares one init with the startup pass when a project is added while that pass runs", async () => {
    const release: Array<() => void> = [];
    indexInit.impl = () => new Promise<void>((resolve) => { release.push(resolve); });
    await mountAfterStartup();

    // Added while the startup pass is still on the global database...
    act(() => setProjects(A, B));
    await settle();
    expect(initsFor(B)).toBe(1);

    // ...which then reaches its own project list (now including B), through
    // the same entry point `runStartupIndexPass` uses.
    const fromStartup = ensureProjectIndex(B);
    expect(initsFor(B)).toBe(1);

    for (const r of release.splice(0)) r();
    await fromStartup;
    await settle();

    // And a pass that only gets to it after the init has finished skips it.
    await ensureProjectIndex(B);
    expect(initsFor(B)).toBe(1);
  });

  it("never indexes the Inbox or the Recordings folder", async () => {
    useSettingsStore.setState({ notesRootPath: "/home/Notesage", icloudNotesagePath: LIB });
    await mountAfterStartup();

    act(() => setProjects(A, `${LIB}/Inbox`, `${LIB}/Recordings`, "/home/Notesage/Inbox", B));
    await settle();

    expect(calls).toEqual([`open:${B}`, `init:${B}`]);
  });

  it("recovers a failing init, and a failed project does not block later ones", async () => {
    indexInit.impl = async (path) => {
      if (path === B) throw new Error("database disk image is malformed");
    };
    await mountAfterStartup();

    act(() => setProjects(A, B));
    await settle();

    // Same recovery as startup: reset the database, try once more, tell the user.
    expect(calls).toEqual([`open:${B}`, `init:${B}`, `reset:${B}`, `init:${B}`]);
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);

    calls.length = 0;
    act(() => setProjects(A, B, C));
    await settle();
    expect(calls).toEqual([`open:${C}`, `init:${C}`]);

    // The failed project is tried again when it is added back.
    indexInit.impl = async () => undefined;
    calls.length = 0;
    act(() => setProjects(A, C));
    act(() => setProjects(A, C, B));
    await settle();
    expect(calls).toEqual([`open:${B}`, `init:${B}`]);
  });

  it("still indexes when the databases cannot be opened up front", async () => {
    api.indexOpen.mockRejectedValueOnce(new Error("spawn failed"));
    await mountAfterStartup();

    act(() => setProjects(A, B));
    await settle();

    expect(initsFor(B)).toBe(1);
  });

  it("indexes a renamed project under its new path", async () => {
    await mountAfterStartup();
    act(() => setProjects(A, B));
    await settle();
    calls.length = 0;

    const renamed = `${LIB}/Beta 2`;
    act(() => setProjects(A, renamed));
    await settle();

    expect(calls).toEqual([`open:${renamed}`, `init:${renamed}`]);
  });

  it("indexes every project again under its new path when the library moves", async () => {
    setProjects(A, B);
    await mountAfterStartup();

    act(() => setProjects("/new/Alpha", "/new/Beta"));
    await settle();

    expect(calls).toEqual(["open:/new/Alpha,/new/Beta", "init:/new/Alpha", "init:/new/Beta"]);
  });

  it("indexes a project again when it is removed and added back", async () => {
    await mountAfterStartup();
    act(() => setProjects(A, B));
    await settle();
    expect(initsFor(B)).toBe(1);

    act(() => setProjects(A));
    await settle();
    expect(initsFor(B)).toBe(1);

    act(() => setProjects(A, B));
    await settle();
    expect(initsFor(B)).toBe(2);
  });

  it("does not start a second init for a project re-added while its first is running", async () => {
    const release: Array<() => void> = [];
    indexInit.impl = () => new Promise<void>((resolve) => { release.push(resolve); });
    await mountAfterStartup();

    act(() => setProjects(A, B));
    await settle();
    act(() => setProjects(A));
    act(() => setProjects(A, B));
    await settle();

    expect(initsFor(B)).toBe(1);
    for (const r of release.splice(0)) r();
    await settle();
    expect(initsFor(B)).toBe(1);
  });
});
