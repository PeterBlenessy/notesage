// @vitest-environment jsdom

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  fireEvent,
} from "@/test/component-harness";
import { FoldersSection } from "../FoldersSection";
import {
  useWorkspaceStore,
  type ExplorerFolder,
} from "@/stores/workspace-store";
import type { FileEntry } from "@/lib/tauri";

// Spy openFile so we can assert child file activation routes through it.
const mockOpenFile = vi.fn();
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    deletePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

function makeFile(name: string, path: string): FileEntry {
  return {
    name,
    path,
    is_directory: false,
    hidden: name.startsWith("."),
  };
}
function makeDir(
  name: string,
  path: string,
  children: FileEntry[] = [],
): FileEntry {
  return {
    name,
    path,
    is_directory: true,
    children,
    hidden: name.startsWith("."),
  };
}
function setExplorerFolders(folders: ExplorerFolder[]): void {
  useWorkspaceStore.setState({ explorerFolders: folders });
}

describe("FoldersSection (sidebar-simplification task #9)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      explorerFolders: [],
      projects: [],
      recentProjects: [],
      notesTree: [],
      pinnedFiles: [],
    });
    mockOpenFile.mockClear();
  });

  it("renders nothing when no explorer folders are open", () => {
    renderWithProviders(<FoldersSection />);
    expect(screen.queryByRole("treeitem")).toBeNull();
    // The "Folders" section header itself is also hidden — when there
    // are no folders, the entire <section> doesn't render.
    expect(screen.queryByText(/^Folders$/)).toBeNull();
  });

  it("renders the section header + one row per explorer folder when non-empty", () => {
    setExplorerFolders([
      { path: "/Users/me/code/alpha", fileTree: [] },
      { path: "/Users/me/code/beta", fileTree: [] },
    ]);
    renderWithProviders(<FoldersSection />);

    expect(screen.getByText("Folders")).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: /open folder alpha/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: /open folder beta/i }),
    ).toBeTruthy();
  });

  it("filters folders by basename when `filter` is provided", () => {
    setExplorerFolders([
      { path: "/Users/me/code/alpha", fileTree: [] },
      { path: "/Users/me/code/beta", fileTree: [] },
      { path: "/Users/me/code/gamma", fileTree: [] },
    ]);
    renderWithProviders(<FoldersSection filter="alp" />);

    expect(
      screen.getByRole("treeitem", { name: /open folder alpha/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("treeitem", { name: /open folder beta/i }),
    ).toBeNull();
  });

  it("ArrowRight on a folder with children sets aria-expanded='true' and renders them", () => {
    setExplorerFolders([
      {
        path: "/Users/me/code/alpha",
        fileTree: [
          makeDir("docs", "/Users/me/code/alpha/docs"),
          makeFile("README.md", "/Users/me/code/alpha/README.md"),
        ],
      },
    ]);
    renderWithProviders(<FoldersSection />);

    const row = screen.getByRole("treeitem", {
      name: /open folder alpha/i,
    }) as HTMLElement;
    expect(row.getAttribute("aria-expanded")).toBe("false");

    fireEvent.keyDown(row, { key: "ArrowRight" });

    const expanded = screen.getByRole("treeitem", {
      name: /open folder alpha/i,
    });
    expect(expanded.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen.getByRole("treeitem", { name: /open folder docs/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("treeitem", { name: /open file README\.md/i }),
    ).toBeTruthy();
  });

  it("ArrowRight on a folder with no children is a no-op (no phantom expand)", () => {
    setExplorerFolders([{ path: "/Users/me/code/empty", fileTree: [] }]);
    renderWithProviders(<FoldersSection />);

    const row = screen.getByRole("treeitem", {
      name: /open folder empty/i,
    }) as HTMLElement;
    fireEvent.keyDown(row, { key: "ArrowRight" });

    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  it("ArrowLeft on an expanded folder collapses it", () => {
    setExplorerFolders([
      {
        path: "/Users/me/code/alpha",
        fileTree: [makeFile("a.md", "/Users/me/code/alpha/a.md")],
      },
    ]);
    renderWithProviders(<FoldersSection />);

    const row = screen.getByRole("treeitem", {
      name: /open folder alpha/i,
    }) as HTMLElement;
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(
      screen.getByRole("treeitem", { name: /open folder alpha/i })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.keyDown(row, { key: "ArrowLeft" });
    expect(
      screen.getByRole("treeitem", { name: /open folder alpha/i })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("Enter on a child file row routes to openFile", () => {
    setExplorerFolders([
      {
        path: "/Users/me/code/alpha",
        fileTree: [makeFile("note.md", "/Users/me/code/alpha/note.md")],
      },
    ]);
    renderWithProviders(<FoldersSection />);

    const folderRow = screen.getByRole("treeitem", {
      name: /open folder alpha/i,
    });
    fireEvent.keyDown(folderRow, { key: "ArrowRight" }); // expand
    const fileRow = screen.getByRole("treeitem", {
      name: /open file note\.md/i,
    });
    fireEvent.keyDown(fileRow, { key: "Enter" });

    expect(mockOpenFile).toHaveBeenCalledWith(
      "/Users/me/code/alpha/note.md",
      "note.md",
    );
  });

  it("subscribes to sidebar-events bus and inline-expands on `expand-path`", async () => {
    setExplorerFolders([
      {
        path: "/Users/me/code/alpha",
        fileTree: [makeFile("note.md", "/Users/me/code/alpha/note.md")],
      },
    ]);
    renderWithProviders(<FoldersSection />);

    const { emitSidebarEvent } = await import("@/lib/sidebar-events");
    emitSidebarEvent({
      type: "expand-path",
      projectPath: "/Users/me/code/alpha",
      targetPath: "/Users/me/code/alpha",
    });

    // The state update is synchronous; child row should appear after
    // the next render flush.
    const expanded = await screen.findByRole("treeitem", {
      name: /open folder alpha/i,
    });
    expect(expanded.getAttribute("aria-expanded")).toBe("true");
  });

  it("Folders ignores expand-path events for paths it doesn't own", async () => {
    setExplorerFolders([
      {
        path: "/Users/me/code/alpha",
        fileTree: [makeFile("a.md", "/Users/me/code/alpha/a.md")],
      },
    ]);
    renderWithProviders(<FoldersSection />);

    const { emitSidebarEvent } = await import("@/lib/sidebar-events");
    emitSidebarEvent({
      type: "expand-path",
      projectPath: "/some/other/folder", // not in the store
      targetPath: "/some/other/folder/x",
    });

    const row = screen.getByRole("treeitem", {
      name: /open folder alpha/i,
    });
    expect(row.getAttribute("aria-expanded")).toBe("false");
  });

  // Regression for keyboard-only walkthrough finding #5 (2026-04-28).
  // Roving-tabindex sections with `tabIndex={isFocused ? 0 : -1}`
  // are invisible to Tab when no row is focused yet — the entire
  // section is skipped. The fix is the "no row focused yet"
  // fallback that mirrors ProjectsSection: `isFocused ||
  // !hasFocusWithin ? 0 : -1`.
  it("first folder row is Tab-reachable when no row is focused yet (Tab order regression)", () => {
    setExplorerFolders([
      {
        path: "/Users/me/code/alpha",
        fileTree: [makeFile("a.md", "/Users/me/code/alpha/a.md")],
      },
      {
        path: "/Users/me/code/beta",
        fileTree: [makeFile("b.md", "/Users/me/code/beta/b.md")],
      },
    ]);
    renderWithProviders(<FoldersSection />);

    const folderRows = screen.getAllByRole("treeitem");
    // At least one row must expose tabIndex=0 so external Tab from
    // a sibling section (Projects above, Recent below) can land in
    // FoldersSection. Without the fallback, every row is tabIndex=-1
    // because focusedRowId starts at null.
    const tabbable = folderRows.filter(
      (row) => row.getAttribute("tabindex") === "0",
    );
    expect(tabbable.length).toBeGreaterThanOrEqual(1);
  });
});
