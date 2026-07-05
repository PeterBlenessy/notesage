// @vitest-environment jsdom

// cmdk (Command, used by the branch-compare picker) observes its list size
// via ResizeObserver and scrolls the selected item into view — neither
// exists in jsdom. Polyfill both.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithProviders,
  screen,
  fireEvent,
  waitFor,
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from "@/test/component-harness";
import {
  SidebarContextMenu,
  SIDEBAR_ENTER_RENAME_MODE_EVENT,
} from "../SidebarContextMenu";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useGitStore } from "@/stores/git-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDiffReviewStore } from "@/stores/diff-review-store";

// ---------------------------------------------------------------------------
// Mock useFileOperations — the menu calls openFile + deletePath
// ---------------------------------------------------------------------------

const mockOpenFile = vi.fn();
const mockDeletePath = vi.fn();

vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: vi.fn(() => ({
    openFile: mockOpenFile,
    deletePath: mockDeletePath,
    openFileAtTag: vi.fn(),
    openFileAtText: vi.fn(),
    saveFile: vi.fn(),
    createFile: vi.fn(),
    createFolder: vi.fn(),
    renamePath: vi.fn(),
    refreshFileTree: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Mock navigator.clipboard — jsdom's clipboard getter cannot be directly
// assigned, so we redefine the property. The getter is an internal jsdom
// implementation detail; redefining it survives across tests.
// ---------------------------------------------------------------------------

const mockClipboardWrite = vi.fn<(text: string) => Promise<void>>().mockImplementation(
  () => Promise.resolve(),
);

function installClipboardMock() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    get: () => ({ writeText: mockClipboardWrite }),
  });
}
installClipboardMock();

function resetStores() {
  useWorkspaceStore.setState({
    explorerFolders: [],
    projects: [],
    recentProjects: [],
    notesTree: [],
    pinnedFiles: [],
    expandedFolders: new Set<string>(),
    explorerCollapsed: false,
    projectsCollapsed: false,
    notesCollapsed: false,
  });
}

function openMenu(text = "row") {
  const trigger = screen.getByTestId(text);
  fireEvent.contextMenu(trigger);
}

/** Plain JSX trigger — NOT a component. `asChild` + Slot need a DOM element. */
const trigger = (label = "row") => (
  <div data-testid={label}>Row content</div>
);

describe("SidebarContextMenu", () => {
  beforeEach(() => {
    resetStores();
    clearMockInvokeHandlers();
    mockOpenFile.mockReset();
    mockOpenFile.mockResolvedValue(undefined);
    mockDeletePath.mockReset();
    mockDeletePath.mockResolvedValue(undefined);
    mockClipboardWrite.mockClear();
    // jsdom re-installs its internal clipboard getter after reset cycles —
    // re-install our mock each test to be safe.
    installClipboardMock();
  });

  afterEach(() => {
    clearMockInvokeHandlers();
  });

  it("renders the trigger children and keeps the menu closed by default", () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    expect(screen.getByTestId("row")).toBeTruthy();
    expect(screen.queryByText("Open")).toBeNull();
  });

  it("opens the menu on right-click with the full action set", () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Rename")).toBeTruthy();
    expect(screen.getByText("Duplicate")).toBeTruthy();
    expect(screen.getByText("Pin")).toBeTruthy();
    expect(screen.getByText("Reveal in Finder")).toBeTruthy();
    expect(screen.getByText("Copy path")).toBeTruthy();
    expect(screen.getByText("Copy filename")).toBeTruthy();
    expect(screen.getByText(/Move to…/)).toBeTruthy();
    expect(screen.getByText("Move to trash")).toBeTruthy();
  });

  it("invokes the onOpen override when Open is selected", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file" onOpen={onOpen}>
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    await user.click(screen.getByText("Open"));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("falls back to useFileOperations.openFile when no onOpen is provided", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/note.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    await user.click(screen.getByText("Open"));

    expect(mockOpenFile).toHaveBeenCalledWith("/a/note.md", "note.md");
  });

  it("dispatches the sidebar:enter-rename-mode event when Rename is clicked", async () => {
    const listener = vi.fn();
    window.addEventListener(SIDEBAR_ENTER_RENAME_MODE_EVENT, listener);
    const user = userEvent.setup();

    try {
      renderWithProviders(
        <SidebarContextMenu filePath="/a/b.md" kind="file">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      await user.click(screen.getByText("Rename"));

      expect(listener).toHaveBeenCalledTimes(1);
      const evt = listener.mock.calls[0][0] as CustomEvent<{ filePath: string }>;
      expect(evt.detail.filePath).toBe("/a/b.md");
    } finally {
      window.removeEventListener(SIDEBAR_ENTER_RENAME_MODE_EVENT, listener);
    }
  });

  it("shows Pin when the file is not pinned and calls pinFile when selected", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.getByText("Pin")).toBeTruthy();
    await user.click(screen.getByText("Pin"));

    expect(useWorkspaceStore.getState().pinnedFiles).toContain("/a/b.md");
  });

  it("shows Unpin when the file is pinned and calls unpinFile when selected", async () => {
    useWorkspaceStore.setState({ pinnedFiles: ["/a/b.md"] });
    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.getByText("Unpin")).toBeTruthy();
    expect(screen.queryByText("Pin")).toBeNull();
    await user.click(screen.getByText("Unpin"));

    expect(useWorkspaceStore.getState().pinnedFiles).not.toContain("/a/b.md");
  });

  it("calls tauriApi.revealInFinder when Reveal in Finder is selected", async () => {
    const revealHandler = vi.fn<(args: unknown) => void>();
    setMockInvokeHandler("reveal_in_finder", (args) => {
      revealHandler(args);
      return Promise.resolve();
    });
    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/abs/path.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    await user.click(screen.getByText("Reveal in Finder"));

    await waitFor(() => expect(revealHandler).toHaveBeenCalled());
    expect(revealHandler).toHaveBeenCalledWith({ path: "/abs/path.md" });
  });

  it("writes the full path to the clipboard when Copy path is selected", async () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/abs/path/alpha.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    // user.click times out on Radix context-menu items in jsdom; a raw click
    // event is enough to fire the onSelect handler.
    fireEvent.click(screen.getByText("Copy path"));

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith("/abs/path/alpha.md");
  });

  it("writes the basename to the clipboard when Copy filename is selected", async () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/abs/path/alpha.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    fireEvent.click(screen.getByText("Copy filename"));

    await waitFor(() => expect(mockClipboardWrite).toHaveBeenCalled());
    expect(mockClipboardWrite).toHaveBeenCalledWith("alpha.md");
  });

  it("shows a confirmation dialog and calls deletePath when Move to trash is confirmed", async () => {
    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    await user.click(screen.getByText("Move to trash"));

    // Dialog opens
    expect(await screen.findByText("Move to trash?")).toBeTruthy();

    // Confirm — click the destructive action button (AlertDialogAction).
    const dialog = screen.getByRole("alertdialog");
    const confirmButton = Array.from(
      dialog.querySelectorAll("button"),
    ).find((b) => b.textContent === "Move to trash") as HTMLButtonElement;
    expect(confirmButton).toBeTruthy();
    await user.click(confirmButton);

    await waitFor(() => expect(mockDeletePath).toHaveBeenCalled());
    expect(mockDeletePath).toHaveBeenCalledWith("/a/b.md");
  });

  it("hides Duplicate and Pin/Unpin for folders (live-test 2026-04-25)", () => {
    // Was: disabled-but-visible per #128. Live-test 2026-04-25 changed
    // the policy — disabled menu items felt broken; folders / projects
    // simply shouldn't expose those actions. The wider "kind === file"
    // gate also hides them for projects (covered by a sibling test
    // now that there's a `kind="project"` variant).
    renderWithProviders(
      <SidebarContextMenu filePath="/a/sub" kind="folder">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();

    expect(screen.queryByText("Duplicate")).toBeNull();
    expect(screen.queryByText("Pin")).toBeNull();
    expect(screen.queryByText("Unpin")).toBeNull();
  });

  it("always disables Move to…", () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();

    const moveTo = screen.getByText(/Move to…/).closest("[role='menuitem']");
    expect(moveTo?.getAttribute("data-disabled")).not.toBeNull();
  });

  it("duplicates a file to '<stem> copy.<ext>' when the candidate is unused", async () => {
    // path_exists returns false → accept the first candidate
    setMockInvokeHandler("path_exists", () => Promise.resolve(false));
    setMockInvokeHandler("read_file", () => Promise.resolve("hello"));
    const writeHandler = vi.fn<(args: unknown) => void>();
    setMockInvokeHandler("write_file", (args) => {
      writeHandler(args);
      return Promise.resolve();
    });

    const user = userEvent.setup();

    renderWithProviders(
      <SidebarContextMenu filePath="/docs/alpha.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    await user.click(screen.getByText("Duplicate"));

    await waitFor(() => expect(writeHandler).toHaveBeenCalled());
    expect(writeHandler).toHaveBeenCalledWith({
      path: "/docs/alpha copy.md",
      content: "hello",
    });
  });

  // -------------------------------------------------------------------
  // #128 — FileTreeItem parity (New File/Folder, Make Project, Add to
  // chat, Export as…, Commit…). Each test seeds the relevant store /
  // mock and asserts the menu item is either rendered or suppressed
  // per the outcome-shaped acceptance criteria.
  // -------------------------------------------------------------------

  it("shows New File + New Folder on folder rows (#128)", () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/a/sub" kind="folder">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();

    expect(screen.getByText("New File")).toBeTruthy();
    expect(screen.getByText("New Folder")).toBeTruthy();
  });

  it("shows New File (but NOT New Folder) on file rows (#128)", () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/a/b.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();

    expect(screen.getByText("New File")).toBeTruthy();
    expect(screen.queryByText("New Folder")).toBeNull();
  });

  it("does NOT show 'Make Project' / 'Manage with Notesage' on sub-folder rows (moved to top-level FoldersSection)", () => {
    renderWithProviders(
      <SidebarContextMenu filePath="/a/sub" kind="folder">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.queryByText("Make Project")).toBeNull();
    expect(screen.queryByText("Manage with Notesage")).toBeNull();
    expect(screen.queryByText("Open as Notesage folder")).toBeNull();
  });

  it("shows Add to chat on image files only (#128)", () => {
    const { unmount } = renderWithProviders(
      <SidebarContextMenu filePath="/a/pic.png" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.getByText("Add to chat")).toBeTruthy();
    unmount();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/notes.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.queryByText("Add to chat")).toBeNull();
  });

  it("shows Export as… on markdown files only (#128)", () => {
    const { unmount } = renderWithProviders(
      <SidebarContextMenu filePath="/a/doc.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.getByText("Export as…")).toBeTruthy();
    unmount();

    renderWithProviders(
      <SidebarContextMenu filePath="/a/pic.png" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.queryByText("Export as…")).toBeNull();
  });

  it("Export as… submenu trigger is present on markdown rows (#128)", () => {
    // Submenu open-on-hover doesn't reliably fire in jsdom, so assert the
    // trigger is present; the dispatch itself is exercised by the
    // component's own code (single-line wrapper around
    // `dispatchEvent(new CustomEvent(…))`) and by the App-level listener
    // in `App.tsx`.
    renderWithProviders(
      <SidebarContextMenu filePath="/a/doc.md" kind="file">
        {trigger()}
      </SidebarContextMenu>,
    );
    openMenu();
    expect(screen.getByText("Export as…")).toBeTruthy();
  });

  // -------------------------------------------------------------------
  // Branch diff review re-wire — "Compare branch…" / "End branch review"
  // on repo-backed container rows.
  // -------------------------------------------------------------------

  describe("Compare branch… (branch diff review)", () => {
    function seedRepoRoot(path: string, isGitRepo = true) {
      useSettingsStore.setState({
        gitEnabled: true,
      } as unknown as Parameters<typeof useSettingsStore.setState>[0]);
      useGitStore.setState({
        repos: {
          [path]: {
            isGitRepo,
            currentBranch: "main",
            fileStatuses: [],
            fileStatusMap: new Map(),
            isLoading: false,
            statusError: false,
          },
        },
      });
    }

    beforeEach(() => {
      useGitStore.setState({ repos: {} });
      useSettingsStore.setState({
        gitEnabled: false,
      } as unknown as Parameters<typeof useSettingsStore.setState>[0]);
      useDiffReviewStore.setState({
        compareBranch: null,
        baseBranch: null,
        changedFiles: [],
        reviewActive: false,
        isLoading: false,
        error: null,
      });
    });

    it("shows Compare branch… on a repo-backed project row", () => {
      seedRepoRoot("/proj");
      renderWithProviders(
        <SidebarContextMenu filePath="/proj" kind="project">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      expect(screen.getByText("Compare branch…")).toBeTruthy();
    });

    it("shows Compare branch… on a repo-backed folder row", () => {
      seedRepoRoot("/folder");
      renderWithProviders(
        <SidebarContextMenu filePath="/folder" kind="folder">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      expect(screen.getByText("Compare branch…")).toBeTruthy();
    });

    it("hides Compare branch… on non-repo container rows", () => {
      seedRepoRoot("/proj", false);
      renderWithProviders(
        <SidebarContextMenu filePath="/proj" kind="project">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      expect(screen.queryByText("Compare branch…")).toBeNull();
    });

    it("hides Compare branch… when git integration is disabled", () => {
      seedRepoRoot("/proj");
      useSettingsStore.setState({
        gitEnabled: false,
      } as unknown as Parameters<typeof useSettingsStore.setState>[0]);
      renderWithProviders(
        <SidebarContextMenu filePath="/proj" kind="project">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      expect(screen.queryByText("Compare branch…")).toBeNull();
    });

    it("hides Compare branch… on file rows even inside a repo", () => {
      seedRepoRoot("/proj");
      renderWithProviders(
        <SidebarContextMenu filePath="/proj/a.md" kind="file">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      expect(screen.queryByText("Compare branch…")).toBeNull();
    });

    it("opens the branch picker when Compare branch… is selected", async () => {
      seedRepoRoot("/proj");
      setMockInvokeHandler("git_branch_list", () => ["feature/x", "main"]);
      const user = userEvent.setup();

      renderWithProviders(
        <SidebarContextMenu filePath="/proj" kind="project">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      await user.click(screen.getByText("Compare branch…"));

      // The picker opens after a requestAnimationFrame; the picked branch
      // list excludes the current branch (main).
      await waitFor(() => {
        expect(screen.getByText("feature/x")).toBeTruthy();
      });
      expect(
        screen.getByPlaceholderText("Compare against branch…"),
      ).toBeTruthy();
    });

    it("selecting a branch in the picker starts the review with the right args", async () => {
      seedRepoRoot("/proj");
      setMockInvokeHandler("git_branch_list", () => ["feature/x", "main"]);
      setMockInvokeHandler("git_diff_files", () => ["a.md"]);
      setMockInvokeHandler("git_diff_file", () => []);
      const user = userEvent.setup();

      renderWithProviders(
        <SidebarContextMenu filePath="/proj" kind="project">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      await user.click(screen.getByText("Compare branch…"));
      await waitFor(() => {
        expect(screen.getByText("feature/x")).toBeTruthy();
      });
      await user.click(screen.getByText("feature/x"));

      await waitFor(() => {
        const state = useDiffReviewStore.getState();
        expect(state.reviewActive).toBe(true);
        // Base = the checked-out branch from git-store; compare = picked.
        expect(state.baseBranch).toBe("main");
        expect(state.compareBranch).toBe("feature/x");
      });
    });

    it("shows End branch review while a review is active and ends it on select", async () => {
      seedRepoRoot("/proj");
      useDiffReviewStore.setState({
        reviewActive: true,
        baseBranch: "main",
        compareBranch: "feature/x",
      });
      const user = userEvent.setup();

      renderWithProviders(
        <SidebarContextMenu filePath="/proj" kind="project">
          {trigger()}
        </SidebarContextMenu>,
      );
      openMenu();
      expect(screen.queryByText("Compare branch…")).toBeNull();
      await user.click(screen.getByText("End branch review"));

      await waitFor(() => {
        expect(useDiffReviewStore.getState().reviewActive).toBe(false);
      });
      expect(useDiffReviewStore.getState().compareBranch).toBeNull();
    });
  });
});
