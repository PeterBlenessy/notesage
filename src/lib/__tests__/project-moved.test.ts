// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { applyProjectMoved } from "@/lib/project-moved";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useProjectMetadataStore } from "@/stores/project-metadata-store";
import { useEditorStore } from "@/stores/editor-store";

const OLD = "/old/Notes";
const NEW = "/new/Notes";

function deps(over: Partial<Parameters<typeof applyProjectMoved>[2]> = {}) {
  return {
    listDirectory: vi.fn(async () => []),
    writeFile: vi.fn(async () => {}),
    ...over,
  };
}

/**
 * The bookkeeping when one project's folder moves — shared by the
 * per-project iCloud sync and the library migration, which had grown two
 * different answers to the same question.
 */
describe("a project that moved", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ projects: [{ path: OLD, fileTree: [] }], pinnedFiles: [] });
    useProjectMetadataStore.setState({ metadataMap: {} });
    useEditorStore.setState({ openDocuments: [], persistedTabs: [], recentFiles: [], scrollPositions: {} });
  });

  it("re-keys the project metadata, so an AI lock keeps enforcing", async () => {
    // The bug this exists to prevent. `metadataMap` is keyed by absolute
    // path, so a moved project's lock was looked up under the old key,
    // `getProjectLock` returned nothing, and the lock silently stopped
    // applying — for a control whose whole purpose is that a project's
    // contents cannot reach the wrong provider.
    useProjectMetadataStore.setState({
      metadataMap: {
        [OLD]: { name: "Notes", aiLock: { connectionId: "conn-1", lockedAt: "2026-01-01" } } as never,
      },
    });

    await applyProjectMoved(OLD, NEW, deps());

    const map = useProjectMetadataStore.getState().metadataMap;
    expect(map[OLD], "the old key must be gone").toBeUndefined();
    expect(map[NEW]?.aiLock?.connectionId).toBe("conn-1");
  });

  it("brings the recorded name in line with the folder it now lives in", async () => {
    useProjectMetadataStore.setState({
      metadataMap: { [OLD]: { name: "Notes" } as never },
    });
    await applyProjectMoved(OLD, "/new/Notes (from iCloud Drive)", deps());
    expect(
      useProjectMetadataStore.getState().metadataMap["/new/Notes (from iCloud Drive)"]?.name,
    ).toBe("Notes (from iCloud Drive)");
  });

  it("does not rewrite a sibling whose name merely starts the same", async () => {
    // `editorStore.updateFilePaths` matches on a bare `startsWith`, so moving
    // `Notes` also rewrote `Notesbook.md` into `<new>book.md` — pointing an
    // open tab, a recent and a scroll position at a file that does not exist.
    useEditorStore.setState({
      openDocuments: [
        { id: "1", filePath: `${OLD}/a.md`, fileName: "a.md" } as never,
        { id: "2", filePath: "/old/Notesbook.md", fileName: "Notesbook.md" } as never,
      ],
    });

    await applyProjectMoved(OLD, NEW, deps());

    const paths = useEditorStore.getState().openDocuments.map((d) => d.filePath);
    expect(paths).toContain(`${NEW}/a.md`);
    expect(paths, "the sibling must be untouched").toContain("/old/Notesbook.md");
  });

  it("re-reads the tree rather than blanking it", async () => {
    // `updateProjectPath(from, to, [])` wipes the cached tree and nothing
    // refills it: watchers on the new root report only future events, so
    // every moved project renders empty until a restart.
    const tree = [{ name: "a.md", path: `${NEW}/a.md`, is_directory: false, hidden: false }];
    await applyProjectMoved(OLD, NEW, deps({ listDirectory: vi.fn(async () => tree) }));
    expect(useWorkspaceStore.getState().projects[0].fileTree).toEqual(tree);
  });

  it("still moves the path when the tree cannot be read, and says so", async () => {
    const failures: string[] = [];
    await applyProjectMoved(
      OLD,
      NEW,
      deps({
        listDirectory: vi.fn(async () => {
          throw new Error("iCloud is not responding");
        }),
        onTreeReadFailure: (p, e) => failures.push(`${p}: ${String(e)}`),
      }),
    );
    expect(useWorkspaceStore.getState().projects[0].path).toBe(NEW);
    expect(failures[0]).toContain("iCloud is not responding");
  });

  it("does not fail the move when project.json cannot be written", async () => {
    useProjectMetadataStore.setState({ metadataMap: { [OLD]: { name: "Notes" } as never } });
    const failures: string[] = [];
    await applyProjectMoved(
      OLD,
      NEW,
      deps({
        writeFile: vi.fn(async () => {
          throw new Error("read-only");
        }),
        onTreeReadFailure: (p, e) => failures.push(`${p}: ${String(e)}`),
      }),
    );
    // In-memory state is already right; the file refreshes on next bootstrap.
    expect(useProjectMetadataStore.getState().metadataMap[NEW]).toBeTruthy();
    expect(failures.join(" ")).toContain("read-only");
  });
});
