// @vitest-environment jsdom

/**
 * Tests for FolderPeek (task #36) — the hover popover that previews one level
 * of a project's contents from the Projects section of the quiet sidebar.
 *
 * These tests verify:
 *  - lazy open (no popover until 220 ms hover)
 *  - close on mouse-leave (after grace period)
 *  - one-level listing with folders-before-files, alphabetical sort
 *  - caps (+N more) for folders and files
 *  - empty state
 *  - hidden / .DS_Store filtering
 *  - file-click opens a tab via `read_file`
 *  - footer button disabled without onOpenTreeOverlay, enabled with it
 *  - reduced motion: animation classes omitted
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  act,
  setMockInvokeHandler,
} from "@/test/component-harness";
import type { FileEntry } from "@/lib/tauri";
import { useEditorStore } from "@/stores/editor-store";

// ---------------------------------------------------------------------------
// Mock useReducedMotion — flipped per-test
// ---------------------------------------------------------------------------

const useReducedMotionMock = vi.fn<() => boolean>(() => false);

vi.mock("@/hooks/useReducedMotion", () => ({
  useReducedMotion: () => useReducedMotionMock(),
}));

// Lazy import after mocks so the hook mock is picked up.
import { FolderPeek } from "../FolderPeek";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFile(name: string, path: string): FileEntry {
  return { name, path, is_directory: false, hidden: name.startsWith(".") };
}

function makeDir(name: string, path: string, children: FileEntry[] = []): FileEntry {
  return {
    name,
    path,
    is_directory: true,
    children,
    hidden: name.startsWith("."),
  };
}

function resetStores(): void {
  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    persistedTabs: [],
    persistedActiveFilePath: null,
  });
}

function Trigger() {
  return (
    <button type="button" data-testid="trigger">
      alpha
    </button>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("FolderPeek (#36)", () => {
  beforeEach(() => {
    useReducedMotionMock.mockReturnValue(false);
    resetStores();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the trigger and does NOT open the popover on mount", () => {
    renderWithProviders(
      <FolderPeek projectPath="/p/alpha" fileTree={[]}>
        <Trigger />
      </FolderPeek>
    );
    expect(screen.getByTestId("trigger")).toBeTruthy();
    expect(screen.queryByTestId("folder-peek-content")).toBeNull();
  });

  it("opens the popover after a 220 ms hover delay", () => {
    renderWithProviders(
      <FolderPeek
        projectPath="/p/alpha"
        fileTree={[makeFile("a.md", "/p/alpha/a.md")]}
      >
        <Trigger />
      </FolderPeek>
    );

    const trigger = screen.getByTestId("trigger").parentElement!;
    fireEvent.mouseEnter(trigger);

    // Not yet opened — only 100 ms has passed.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.queryByTestId("folder-peek-content")).toBeNull();

    // Cross the 220 ms threshold.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByTestId("folder-peek-content")).toBeTruthy();
  });

  it("closes on mouse-leave after the grace period", () => {
    renderWithProviders(
      <FolderPeek
        projectPath="/p/alpha"
        fileTree={[makeFile("a.md", "/p/alpha/a.md")]}
      >
        <Trigger />
      </FolderPeek>
    );

    const triggerWrap = screen.getByTestId("trigger").parentElement!;
    fireEvent.mouseEnter(triggerWrap);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });
    expect(screen.getByTestId("folder-peek-content")).toBeTruthy();

    fireEvent.mouseLeave(triggerWrap);
    // Still open during the grace window.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(screen.queryByTestId("folder-peek-content")).toBeTruthy();

    // After the grace window fully elapses.
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByTestId("folder-peek-content")).toBeNull();
  });

  const HOVER_DELAY = 220;

  it("renders folders before files, both alphabetical and case-insensitive", () => {
    const tree: FileEntry[] = [
      makeFile("zeta.md", "/p/zeta.md"),
      makeDir("Beta", "/p/Beta"),
      makeFile("alpha.md", "/p/alpha.md"),
      makeDir("alpha-dir", "/p/alpha-dir"),
    ];
    renderWithProviders(
      <FolderPeek projectPath="/p" fileTree={tree}>
        <Trigger />
      </FolderPeek>
    );

    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const popover = screen.getByTestId("folder-peek-content");
    const items = Array.from(popover.querySelectorAll("button")).map(
      (el) => el.textContent?.trim()
    );
    // Folders first: alpha-dir, Beta. Files second: alpha.md, zeta.md.
    // Footer "See full tree" is last.
    const folderAndFileItems = items.filter(
      (t) => t && !t.startsWith("See full tree")
    );
    expect(folderAndFileItems).toEqual([
      "alpha-dir",
      "Beta",
      "alpha.md",
      "zeta.md",
    ]);
  });

  it("caps folders at 8 and shows +N more", () => {
    const tree: FileEntry[] = [];
    for (let i = 1; i <= 10; i++) {
      tree.push(makeDir(`dir-${String(i).padStart(2, "0")}`, `/p/dir-${i}`));
    }
    renderWithProviders(
      <FolderPeek projectPath="/p" fileTree={tree}>
        <Trigger />
      </FolderPeek>
    );

    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const popover = screen.getByTestId("folder-peek-content");
    expect(popover.textContent).toMatch(/\+2 more/);
  });

  it("caps files at 6 and shows +N more", () => {
    const tree: FileEntry[] = [];
    for (let i = 1; i <= 9; i++) {
      tree.push(makeFile(`f${i}.md`, `/p/f${i}.md`));
    }
    renderWithProviders(
      <FolderPeek projectPath="/p" fileTree={tree}>
        <Trigger />
      </FolderPeek>
    );

    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const popover = screen.getByTestId("folder-peek-content");
    expect(popover.textContent).toMatch(/\+3 more/);
  });

  it("renders an empty-project message when the tree has no visible children", () => {
    renderWithProviders(
      <FolderPeek projectPath="/p/empty" fileTree={[]}>
        <Trigger />
      </FolderPeek>
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });
    const popover = screen.getByTestId("folder-peek-content");
    expect(popover.textContent).toMatch(/empty project/i);
  });

  it("hides hidden files and .DS_Store", () => {
    const tree: FileEntry[] = [
      makeFile(".hidden.md", "/p/.hidden.md"),
      makeFile(".DS_Store", "/p/.DS_Store"),
      makeFile("visible.md", "/p/visible.md"),
    ];
    renderWithProviders(
      <FolderPeek projectPath="/p" fileTree={tree}>
        <Trigger />
      </FolderPeek>
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const popover = screen.getByTestId("folder-peek-content");
    expect(popover.textContent).toMatch(/visible\.md/);
    expect(popover.textContent).not.toMatch(/hidden/);
    expect(popover.textContent).not.toMatch(/DS_Store/);
  });

  it("opens a tab via read_file when a file is clicked", async () => {
    const readFile = vi.fn(() => "# body");
    setMockInvokeHandler(
      "read_file",
      readFile as (args?: Record<string, unknown>) => unknown
    );

    renderWithProviders(
      <FolderPeek
        projectPath="/p/alpha"
        fileTree={[makeFile("note.md", "/p/alpha/note.md")]}
      >
        <Trigger />
      </FolderPeek>
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const noteButton = screen.getByRole("button", { name: /note\.md/ });
    // Stop faking timers so the async file-open flow can actually progress.
    vi.useRealTimers();
    fireEvent.click(noteButton);

    await waitFor(() => {
      expect(readFile).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/p/alpha/note.md" })
      );
    });
    await waitFor(() => {
      const tabs = useEditorStore.getState().tabs;
      expect(tabs).toHaveLength(1);
      expect(tabs[0].filePath).toBe("/p/alpha/note.md");
    });
  });

  it("disables the footer button when onOpenTreeOverlay is missing", () => {
    renderWithProviders(
      <FolderPeek
        projectPath="/p/alpha"
        fileTree={[makeFile("a.md", "/p/alpha/a.md")]}
      >
        <Trigger />
      </FolderPeek>
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const footerBtn = screen.getByRole("button", { name: /see full tree/i });
    expect(footerBtn.hasAttribute("disabled")).toBe(true);
  });

  it("enables the footer button and invokes onOpenTreeOverlay when provided", () => {
    const onOpen = vi.fn();
    renderWithProviders(
      <FolderPeek
        projectPath="/p/alpha"
        fileTree={[makeFile("a.md", "/p/alpha/a.md")]}
        onOpenTreeOverlay={onOpen}
      >
        <Trigger />
      </FolderPeek>
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const footerBtn = screen.getByRole("button", { name: /see full tree/i });
    expect(footerBtn.hasAttribute("disabled")).toBe(false);
    fireEvent.click(footerBtn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("omits animation classes when reduced motion is preferred", () => {
    useReducedMotionMock.mockReturnValue(true);
    renderWithProviders(
      <FolderPeek
        projectPath="/p/alpha"
        fileTree={[makeFile("a.md", "/p/alpha/a.md")]}
      >
        <Trigger />
      </FolderPeek>
    );
    fireEvent.mouseEnter(screen.getByTestId("trigger").parentElement!);
    act(() => {
      vi.advanceTimersByTime(HOVER_DELAY + 1);
    });

    const popover = screen.getByTestId("folder-peek-content");
    const classes = popover.className.split(/\s+/);
    expect(classes).not.toContain("data-[state=open]:animate-in");
    expect(classes).not.toContain("data-[state=closed]:animate-out");
  });

  it("marks the project row with data-peek-trigger for #37 keyboard discovery", () => {
    renderWithProviders(
      <FolderPeek projectPath="/p/alpha" fileTree={[]}>
        <Trigger />
      </FolderPeek>
    );
    const triggerWrap = screen.getByTestId("trigger").parentElement!;
    expect(triggerWrap.getAttribute("data-peek-trigger")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// derivePeekChildren — shared helper for hover popover (#36) + inline
// keyboard expansion (#37). These assertions lock the contract so the two
// surfaces never drift apart.
// ---------------------------------------------------------------------------

import { derivePeekChildren } from "../FolderPeek";

describe("derivePeekChildren", () => {
  it("returns empty state for an empty tree", () => {
    const result = derivePeekChildren([]);
    expect(result.isEmpty).toBe(true);
    expect(result.folders).toEqual([]);
    expect(result.files).toEqual([]);
    expect(result.folderOverflow).toBe(0);
    expect(result.fileOverflow).toBe(0);
  });

  it("puts folders before files, alphabetical case-insensitive", () => {
    const tree: FileEntry[] = [
      makeFile("zeta.md", "/p/zeta.md"),
      makeDir("Beta", "/p/Beta"),
      makeFile("alpha.md", "/p/alpha.md"),
      makeDir("alpha-dir", "/p/alpha-dir"),
    ];
    const result = derivePeekChildren(tree);
    expect(result.folders.map((f) => f.name)).toEqual(["alpha-dir", "Beta"]);
    expect(result.files.map((f) => f.name)).toEqual(["alpha.md", "zeta.md"]);
    expect(result.isEmpty).toBe(false);
  });

  it("caps folders at 8 and reports the overflow count", () => {
    const tree: FileEntry[] = [];
    for (let i = 1; i <= 10; i++) {
      tree.push(
        makeDir(`dir-${String(i).padStart(2, "0")}`, `/p/dir-${i}`)
      );
    }
    const result = derivePeekChildren(tree);
    expect(result.folders).toHaveLength(8);
    expect(result.folderOverflow).toBe(2);
  });

  it("caps files at 6 and reports the overflow count", () => {
    const tree: FileEntry[] = [];
    for (let i = 1; i <= 9; i++) {
      tree.push(makeFile(`f${i}.md`, `/p/f${i}.md`));
    }
    const result = derivePeekChildren(tree);
    expect(result.files).toHaveLength(6);
    expect(result.fileOverflow).toBe(3);
  });

  it("filters out hidden entries and .DS_Store", () => {
    const tree: FileEntry[] = [
      makeFile(".hidden.md", "/p/.hidden.md"),
      makeFile(".DS_Store", "/p/.DS_Store"),
      makeFile("visible.md", "/p/visible.md"),
      makeDir(".git", "/p/.git"),
      makeDir("docs", "/p/docs"),
    ];
    const result = derivePeekChildren(tree);
    expect(result.folders.map((f) => f.name)).toEqual(["docs"]);
    expect(result.files.map((f) => f.name)).toEqual(["visible.md"]);
  });
});
