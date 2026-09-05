// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "@/test/component-harness";
import { getListenerCount, setMockInvokeHandler } from "@/test/tauri-mock";
import { InboxSection } from "@/components/sidebar/quiet/InboxSection";
import { useInboxStore, resetInboxCaches } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";

const INBOX = "/Users/peter/Notesage/Inbox";

describe("InboxSection (sidebar row)", () => {
  beforeEach(() => {
    resetInboxCaches();
    useInboxStore.setState({ open: false, dir: null, items: [], progress: { version: 1, items: {} }, meta: {} });
    useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter" });
    setMockInvokeHandler("list_files_shallow", () => [
      { name: "a.html", path: `${INBOX}/a.html`, is_directory: false, hidden: false },
      { name: "b.pdf", path: `${INBOX}/b.pdf`, is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("read_file", () => {
      throw new Error("no sidecar yet");
    });
    setMockInvokeHandler("inbox_card_meta", () => null);
  });

  it("lists the Inbox once the root is known and shows the unread count", async () => {
    renderWithProviders(<InboxSection />);
    const row = await screen.findByTestId("inbox-row");
    expect(row.textContent).toContain("Inbox");
    expect(screen.getByTestId("inbox-unread").textContent).toBe("2");
  });

  it("opens the Inbox mode on click and on Enter", async () => {
    renderWithProviders(<InboxSection />);
    const row = await screen.findByTestId("inbox-row");
    fireEvent.click(row);
    expect(useInboxStore.getState().open).toBe(true);
    useInboxStore.setState({ open: false });
    fireEvent.keyDown(row, { key: "Enter" });
    expect(useInboxStore.getState().open).toBe(true);
    await waitFor(() => expect(row.getAttribute("aria-current")).toBe("page"));
  });

  it("stays hidden while the home directory is unknown or the Inbox is empty", async () => {
    useSettingsStore.setState({ homeDir: null });
    const { unmount } = renderWithProviders(<InboxSection />);
    expect(screen.queryByTestId("inbox-row")).toBeNull();
    unmount();
    useSettingsStore.setState({ homeDir: "/Users/peter" });
    setMockInvokeHandler("list_files_shallow", () => []);
    renderWithProviders(<InboxSection />);
    await waitFor(() => expect(useInboxStore.getState().dir).toBe(INBOX));
    expect(screen.queryByTestId("inbox-row")).toBeNull();
  });

  it("only lists — the folder watch and the change listener live in useInboxArrivals (App root)", async () => {
    // The sidebar unmounts on ⌘⇧L; a listener here would die with it.
    const watchDirectory = vi.fn();
    setMockInvokeHandler("watch_directory", watchDirectory);
    const before = getListenerCount("file-changed-batch");
    renderWithProviders(<InboxSection />);
    await screen.findByTestId("inbox-row");
    expect(watchDirectory).not.toHaveBeenCalled();
    expect(getListenerCount("file-changed-batch")).toBe(before);
  });

  it("drops the badge once everything has been opened", async () => {
    renderWithProviders(<InboxSection />);
    await screen.findByTestId("inbox-unread");
    useInboxStore.getState().markAllRead();
    await waitFor(() => expect(screen.queryByTestId("inbox-unread")).toBeNull());
  });
});
