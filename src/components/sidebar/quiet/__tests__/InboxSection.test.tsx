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

  it("the badge at launch costs one listing and one sidecar read — no capture is opened for it", async () => {
    // 350 captures, 100 of them opened on the phone. The count used to be
    // followed by a whole-file read of every capture for its header.
    const names = Array.from({ length: 350 }, (_, i) => `Article ${i}.html`);
    const calls: Record<string, number> = { list_files_shallow: 0, read_file: 0, inbox_card_meta: 0, article_lead_image: 0 };
    setMockInvokeHandler("list_files_shallow", () => {
      calls.list_files_shallow += 1;
      return names.map((name) => ({ name, path: `${INBOX}/${name}`, is_directory: false, hidden: false, modified: 1 }));
    });
    setMockInvokeHandler("read_file", () => {
      calls.read_file += 1;
      const items: Record<string, unknown> = {};
      for (const name of names.slice(0, 100)) items[name] = { fraction: 0.3, openedAt: "2026-09-02T21:14:07Z", updatedAt: "2026-09-02T21:14:07Z" };
      return JSON.stringify({ version: 2, items });
    });
    setMockInvokeHandler("inbox_card_meta", () => {
      calls.inbox_card_meta += 1;
      return null;
    });
    setMockInvokeHandler("article_lead_image", () => {
      calls.article_lead_image += 1;
      throw new Error("not asked for");
    });
    renderWithProviders(<InboxSection />);
    await waitFor(() => expect(screen.getByTestId("inbox-unread").textContent).toBe("250"));
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual({ list_files_shallow: 1, read_file: 1, inbox_card_meta: 0, article_lead_image: 0 });
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

  it("stays hidden only while the home directory is unknown", async () => {
    useSettingsStore.setState({ homeDir: null });
    renderWithProviders(<InboxSection />);
    expect(screen.queryByTestId("inbox-row")).toBeNull();
  });

  it("shows the row for an empty Inbox — it is a place, not a list", async () => {
    // It used to appear only once it had items, which meant a Mac that had
    // never received a capture had no Inbox at all: nothing to check, nothing
    // to learn, and indistinguishable from a broken feature (Peter,
    // 2026-09-07). The phone shows it at zero for the same reason.
    useSettingsStore.setState({ homeDir: "/Users/peter" });
    setMockInvokeHandler("list_files_shallow", () => []);
    renderWithProviders(<InboxSection />);
    await waitFor(() => expect(useInboxStore.getState().dir).toBe(INBOX));
    expect(await screen.findByTestId("inbox-row")).toBeTruthy();
    // No badge, though: an unread count of zero is noise.
    expect(screen.queryByTestId("inbox-unread")).toBeNull();
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
