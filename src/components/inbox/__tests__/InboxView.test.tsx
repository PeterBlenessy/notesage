// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, renderWithProviders, screen, waitFor } from "@/test/component-harness";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { InboxView } from "@/components/inbox/InboxView";
import { useInboxStore, resetInboxCaches } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const openFileMock = vi.fn(async () => undefined);
const renamePathMock = vi.fn(async () => true);
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({ openFile: openFileMock, renamePath: renamePathMock }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));
vi.mock("@/lib/desktop-thumbnails", () => ({
  getDesktopThumbnail: async () => ({ kind: "icon" }),
  evictDesktopThumbnail: () => undefined,
}));

const ROOT = "/Users/peter/Notesage";
const INBOX = `${ROOT}/Inbox`;
const today = Math.floor(Date.now() / 1000);

describe("InboxView", () => {
  beforeEach(() => {
    resetInboxCaches();
    openFileMock.mockClear();
    renamePathMock.mockClear();
    useInboxStore.setState({
      open: true, dir: null, items: [], loading: false, error: null, progress: { version: 1, items: {} },
      meta: {}, filter: "", selection: [], cursor: null, anchor: null, lastDestination: null, activeItem: null,
    });
    useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter", inboxLayout: "list", inboxCondensed: false, inboxGallerySize: "medium" });
    useWorkspaceStore.setState({ pinnedFiles: [], projects: [{ path: `${ROOT}/Research`, fileTree: [] }] });
    setMockInvokeHandler("list_files_shallow", () => [
      { name: "Riksbanken.html", path: `${INBOX}/Riksbanken.html`, is_directory: false, hidden: false, modified: today },
      { name: "UBS-AI.pdf", path: `${INBOX}/UBS-AI.pdf`, is_directory: false, hidden: false, modified: today - 86_400 },
    ]);
    setMockInvokeHandler("read_file", () => {
      throw new Error("no sidecar");
    });
    setMockInvokeHandler("inbox_card_meta", (args) =>
      (args as { path: string }).path.endsWith(".html")
        ? { title: "Riksbanken lämnar räntan oförändrad", excerpt: "Beskedet var väntat av marknaden.", minutes: 4, site: "di.se", sourceUrl: "https://di.se/x" }
        : null,
    );
    setMockInvokeHandler("write_file", () => undefined);
    setMockInvokeHandler("create_directory", () => undefined);
    setMockInvokeHandler("mark_self_write", () => undefined);
    setMockInvokeHandler("path_exists", () => false);
    setMockInvokeHandler("trash_path", () => undefined);
  });

  it("renders the title with counts, date groups, and article rows with their header", async () => {
    renderWithProviders(<InboxView />);
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(2));
    expect(screen.getByText("2 items · 2 unread")).toBeTruthy();
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Yesterday")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Riksbanken lämnar räntan oförändrad")).toBeTruthy());
    expect(screen.getByText(/di\.se · 4 min/)).toBeTruthy();
    expect(screen.getByText("PDF")).toBeTruthy();
  });

  it("double-click opens the item, marks it opened, and leaves Inbox mode", async () => {
    renderWithProviders(<InboxView />);
    const rows = await screen.findAllByTestId("inbox-row");
    fireEvent.click(rows[0], { detail: 2 });
    await waitFor(() => expect(openFileMock).toHaveBeenCalledWith(`${INBOX}/Riksbanken.html`, "Riksbanken.html"));
    const s = useInboxStore.getState();
    expect(s.open).toBe(false);
    expect(s.activeItem).toBe(`${INBOX}/Riksbanken.html`);
    expect(s.unreadCount()).toBe(1);
  });

  it("e without a chosen destination does nothing but explain", async () => {
    renderWithProviders(<InboxView />);
    const rows = await screen.findAllByTestId("inbox-row");
    fireEvent.click(rows[0]);
    fireEvent.keyDown(rows[0], { key: "e" });
    await new Promise((r) => setTimeout(r, 0));
    expect(renamePathMock).not.toHaveBeenCalled();
    expect(useInboxStore.getState().items).toHaveLength(2);
  });

  it("keyboard: j/k move, Enter opens, e files to the chosen project, ⌘⌫ trashes", async () => {
    useInboxStore.setState({ lastDestination: `${ROOT}/Research` });
    renderWithProviders(<InboxView />);
    const rows = await screen.findAllByTestId("inbox-row");
    fireEvent.click(rows[0]);
    fireEvent.keyDown(rows[0], { key: "j" });
    expect(useInboxStore.getState().cursor).toBe(`${INBOX}/UBS-AI.pdf`);
    fireEvent.keyDown(rows[1], { key: "k" });
    expect(useInboxStore.getState().cursor).toBe(`${INBOX}/Riksbanken.html`);
    fireEvent.keyDown(rows[0], { key: "Enter" });
    await waitFor(() => expect(openFileMock).toHaveBeenCalledTimes(1));
    useInboxStore.setState({ open: true });
    fireEvent.keyDown(rows[0], { key: "e" });
    await waitFor(() => expect(renamePathMock).toHaveBeenCalledWith(`${INBOX}/Riksbanken.html`, `${ROOT}/Research/Riksbanken.html`));
    await waitFor(() => expect(useInboxStore.getState().items).toHaveLength(1));
    // Focus followed the cursor onto the row that slid up — `e, e, e` works
    // without a click in between.
    const remaining = await screen.findAllByTestId("inbox-row");
    await waitFor(() => expect(document.activeElement).toBe(remaining[0]));
    fireEvent.keyDown(document.activeElement as Element, { key: "Backspace", metaKey: true });
    await waitFor(() => expect(useInboxStore.getState().items).toHaveLength(0));
    expect(screen.getByText("Nothing in the Inbox")).toBeTruthy();
    // With nothing left, focus stays in the view (the listbox), not on <body>.
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("listbox"));
  });

  it("filter narrows rows by title and site; Mark all read clears the badge count", async () => {
    renderWithProviders(<InboxView />);
    await screen.findAllByTestId("inbox-row");
    await waitFor(() => expect(screen.getByText(/di\.se/)).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "di.se" } });
    await waitFor(() => expect(screen.getAllByTestId("inbox-row")).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "zzz" } });
    await waitFor(() => expect(screen.queryAllByTestId("inbox-row")).toHaveLength(0));
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "" } });
    act(() => {
      fireEvent.click(screen.getByText("Mark all read"));
    });
    await waitFor(() => expect(screen.getByText("2 items")).toBeTruthy());
  });

  it("switches to the gallery, where the size control replaces Condensed", async () => {
    renderWithProviders(<InboxView />);
    await screen.findAllByTestId("inbox-row");
    expect(screen.getByText("Condensed")).toBeTruthy();
    fireEvent.click(screen.getByText("Gallery"));
    await waitFor(() => expect(screen.getAllByTestId("inbox-card")).toHaveLength(2));
    expect(screen.queryByText("Condensed")).toBeNull();
    fireEvent.click(screen.getByLabelText("Small cards"));
    expect(useSettingsStore.getState().inboxGallerySize).toBe("small");
    expect(useSettingsStore.getState().inboxLayout).toBe("gallery");
  });
});
