/**
 * @vitest-environment jsdom
 *
 * Rehydration error handling for persisted stores (audit 2026-11-22 §10, §7).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@/test/tauri-mock";
import { create } from "zustand";
import { persist } from "zustand/middleware";

async function freshModule() {
  vi.resetModules();
  const mod = await import("../persist-rehydrate");
  const toastError = vi.mocked((await import("sonner")).toast.error);
  toastError.mockClear();
  return { ...mod, toastError };
}

describe("reportRehydrateError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps the raw saved string before it can be overwritten", async () => {
    const { reportRehydrateError, corruptBackupKey } = await freshModule();
    localStorage.setItem("notesage-workspace", '{"state":{"projects":[{"path":"/p"');

    reportRehydrateError("notesage-workspace", new SyntaxError("Unexpected end of JSON input"));

    expect(localStorage.getItem(corruptBackupKey("notesage-workspace"))).toBe(
      '{"state":{"projects":[{"path":"/p"',
    );
  });

  it("tells the user once, however many stores failed", async () => {
    const { reportRehydrateError, toastError } = await freshModule();
    reportRehydrateError("store-a", new Error("x"));
    reportRehydrateError("store-b", new Error("y"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(toastError).toHaveBeenCalledTimes(1);
  });

  it("handleRehydrateResult does nothing when rehydration succeeded", async () => {
    const { handleRehydrateResult, toastError, corruptBackupKey } = await freshModule();
    localStorage.setItem("store-ok", '{"state":{},"version":0}');
    handleRehydrateResult("store-ok", undefined);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toastError).not.toHaveBeenCalled();
    expect(localStorage.getItem(corruptBackupKey("store-ok"))).toBeNull();
  });

  it("end to end: a store whose saved JSON is damaged reports it and keeps the raw value", async () => {
    const { handleRehydrateResult, toastError, corruptBackupKey } = await freshModule();
    const raw = '{"state":{"count":4';
    localStorage.setItem("damaged-store", raw);

    const useStore = create<{ count: number; bump: () => void }>()(
      persist((set) => ({ count: 0, bump: () => set((s) => ({ count: s.count + 1 })) }), {
        name: "damaged-store",
        onRehydrateStorage: () => (_state, error) => handleRehydrateResult("damaged-store", error),
      }),
    );

    // The next state change saves defaults over the damaged value…
    useStore.getState().bump();
    expect(localStorage.getItem("damaged-store")).not.toBe(raw);
    // …which is exactly why the raw string was copied aside first.
    expect(localStorage.getItem(corruptBackupKey("damaged-store"))).toBe(raw);
    await vi.advanceTimersByTimeAsync(5000);
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});

describe("workspace-store rehydration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hydrates on first launch, when nothing is stored (merge gets undefined)", async () => {
    vi.resetModules();
    const { useWorkspaceStore } = await import("@/stores/workspace-store");
    await useWorkspaceStore.persist.rehydrate();
    // It used to throw inside `merge`; zustand swallowed that and
    // `hasHydrated` stayed false for the whole first session.
    expect(useWorkspaceStore.persist.hasHydrated()).toBe(true);
    expect(useWorkspaceStore.getState().projects).toEqual([]);
  });

  it("drops entries of the wrong shape instead of crashing on them", async () => {
    localStorage.setItem(
      "notesage-workspace",
      JSON.stringify({
        state: {
          projects: [{ path: "/good", fileTree: [] }, null, { nope: true }, "x"],
          explorerFolders: [{ path: "/folder" }, 7, {}],
          recentProjects: [{ path: "/good", name: "good" }, { path: "/no-name" }, null],
          expandedFolders: ["/good/sub", 3],
        },
        version: 0,
      }),
    );
    vi.resetModules();
    const { useWorkspaceStore } = await import("@/stores/workspace-store");
    await useWorkspaceStore.persist.rehydrate();

    const s = useWorkspaceStore.getState();
    expect(useWorkspaceStore.persist.hasHydrated()).toBe(true);
    expect(s.projects.map((p) => p.path)).toEqual(["/good"]);
    expect(s.explorerFolders.map((f) => f.path)).toEqual(["/folder"]);
    expect(s.recentProjects).toEqual([{ path: "/good", name: "good" }]);
    expect([...s.expandedFolders]).toEqual(["/good/sub"]);
  });

  it("keeps the raw value of a workspace that cannot be parsed", async () => {
    const raw = '{"state":{"projects":[{"path":"/Users/me/Work"';
    localStorage.setItem("notesage-workspace", raw);
    vi.resetModules();
    const { useWorkspaceStore } = await import("@/stores/workspace-store");
    await useWorkspaceStore.persist.rehydrate();
    expect(localStorage.getItem("notesage-workspace.corrupt")).toBe(raw);
  });
});
