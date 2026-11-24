// @vitest-environment jsdom
/**
 * The Inbox list as a WINDOW, and what that must not break (perf review
 * I-H1 / I-H2 / I-H3 / I-M1 / I-M5).
 *
 * A 350-item Inbox used to put 350 rows in the DOM on every return to the
 * list — each with its own Radix context menu, seven store subscriptions,
 * a header read and a thumbnail request. What is pinned here are the costs:
 * how many rows mount, how many headers and thumbnails are asked for, how
 * many rows re-render when the cursor moves or the folder is listed again,
 * and how many listings an open takes.
 */
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, fireEvent, renderWithProviders, screen, waitFor, within } from "@/test/component-harness";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { InboxView, galleryColumns, resetInboxViewScroll } from "@/components/inbox/InboxView";
import { useInboxStore, resetInboxCaches } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { inboxListing, stubInboxLayout, type InboxLayoutStub } from "./inbox-layout-stub";

const openFileMock = vi.fn(async () => undefined);
const renamePathMock = vi.fn(async () => true);
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({ openFile: openFileMock, renamePath: renamePathMock }),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => undefined) }));

const thumbnailRequests: string[] = [];
vi.mock("@/lib/desktop-thumbnails", () => ({
  getDesktopThumbnail: async (entry: { path: string }) => {
    thumbnailRequests.push(entry.path);
    return { kind: "icon" };
  },
  evictDesktopThumbnail: () => undefined,
}));

// Every row renders one FileIcon (the thumbnails above are icons), and it is
// not memoised — so its render count IS the rows' render count.
const rowRenders: string[] = [];
vi.mock("@/components/sidebar/FileIcon", () => ({
  FileIcon: ({ fileName }: { fileName: string }) => {
    rowRenders.push(fileName);
    return null;
  },
}));

const ROOT = "/Users/peter/Notesage";
const INBOX = `${ROOT}/Inbox`;
const N = 350;

let listing: ReturnType<typeof inboxListing>;
let listCalls: number;
let metaCalls: string[];
let trashCalls: string[][];
let layout: InboxLayoutStub | null = null;

function rows(): HTMLElement[] {
  return screen.queryAllByTestId("inbox-row");
}
function pathsOf(elements: HTMLElement[]): string[] {
  return elements.map((el) => el.getAttribute("data-path") ?? "");
}
function scroller(): HTMLElement {
  return document.querySelector("[data-doc-scroll]") as HTMLElement;
}
function scrollTo(top: number) {
  const el = scroller();
  el.scrollTop = top;
  fireEvent.scroll(el);
}
async function mounted() {
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
  // Let the header reads the mounted rows asked for land (one batch).
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}

beforeEach(() => {
  resetInboxCaches();
  resetInboxViewScroll();
  openFileMock.mockClear();
  renamePathMock.mockClear();
  thumbnailRequests.length = 0;
  rowRenders.length = 0;
  listCalls = 0;
  metaCalls = [];
  trashCalls = [];
  listing = inboxListing(INBOX, N);
  useInboxStore.setState({
    open: true, dir: null, items: [], loading: false, error: null, progress: { version: 2, items: {} },
    meta: {}, filter: "", selection: [], cursor: null, anchor: null, lastDestination: null, activeItem: null,
  });
  useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter", inboxLayout: "list", inboxCondensed: false, inboxGallerySize: "medium" });
  useWorkspaceStore.setState({ pinnedFiles: [], projects: [{ path: `${ROOT}/Research`, fileTree: [] }] });
  setMockInvokeHandler("allow_asset_dir", () => undefined);
  setMockInvokeHandler("list_files_shallow", () => {
    listCalls += 1;
    return listing;
  });
  setMockInvokeHandler("read_file", () => {
    throw new Error("no sidecar");
  });
  setMockInvokeHandler("inbox_card_meta", (args) => {
    const path = (args as { path: string }).path;
    metaCalls.push(path);
    return { title: `Title of ${path.slice(path.lastIndexOf("/") + 1)}`, excerpt: "An excerpt.", minutes: 4, site: "example.org", sourceUrl: "https://example.org/x" };
  });
  setMockInvokeHandler("write_file", () => undefined);
  setMockInvokeHandler("create_directory", () => undefined);
  setMockInvokeHandler("mark_self_write", () => undefined);
  setMockInvokeHandler("path_exists", () => false);
  setMockInvokeHandler("trash_paths", (args) => {
    trashCalls.push((args as { paths: string[] }).paths);
    return [];
  });
});

afterEach(() => {
  layout?.restore();
  layout = null;
});

describe("InboxView — the window (350 items)", () => {
  beforeEach(() => {
    layout = stubInboxLayout({ viewport: 800, row: 80, header: 36 });
  });

  it("mounts the rows on screen, not all 350 — and reads headers and thumbnails only for those", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    const shown = rows();
    // 800px of 80px rows is ten, plus the overscan each way.
    expect(shown.length).toBeGreaterThanOrEqual(10);
    expect(shown.length).toBeLessThanOrEqual(24);
    expect(screen.getByText("350 items · 350 unread")).toBeTruthy();
    // The costs that used to be per ITEM are now per mounted row.
    expect(new Set(metaCalls)).toEqual(new Set(pathsOf(shown)));
    expect(metaCalls).toHaveLength(shown.length);
    expect(new Set(thumbnailRequests)).toEqual(new Set(pathsOf(shown)));
    // One context menu for the list, not one per row.
    expect(document.querySelectorAll('[data-slot="context-menu-trigger"]')).toHaveLength(1);
    expect(document.querySelector('[data-slot="context-menu-trigger"]')?.getAttribute("role")).toBe("listbox");
  });

  it("tells a screen reader the real count and position, which the DOM no longer does", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    const first = rows()[0];
    expect(first.getAttribute("role")).toBe("option");
    expect(first.getAttribute("aria-setsize")).toBe(String(N));
    expect(first.getAttribute("aria-posinset")).toBe("1");
    const list = screen.getByRole("listbox", { name: "Inbox" });
    expect(list.getAttribute("aria-multiselectable")).toBe("true");
    // Options still sit in their date group, under the group's sticky header.
    const today = within(list).getByRole("group", { name: "Today" });
    expect(within(today).getAllByRole("option").length).toBeGreaterThan(0);
    expect(today.querySelector("h2")?.className).toContain("sticky");
    scrollTo(100 * 80);
    await waitFor(() => expect(pathsOf(rows())).toContain(listing[100].path));
    const far = rows().find((el) => el.getAttribute("data-path") === listing[100].path) as HTMLElement;
    expect(far.getAttribute("aria-posinset")).toBe("101");
    expect(far.getAttribute("aria-setsize")).toBe(String(N));
  });

  it("scrolling moves the window; the cursor's row stays mounted so the keyboard is not lost", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.click(rows()[0]);
    expect(document.activeElement).toBe(rows()[0]);
    scrollTo(200 * 80);
    await waitFor(() => expect(pathsOf(rows())).toContain(listing[200].path));
    const shown = pathsOf(rows());
    expect(shown.length).toBeLessThanOrEqual(26);
    expect(shown).not.toContain(listing[20].path);
    // The focused cursor row is far above the window, and still there.
    expect(shown).toContain(listing[0].path);
    expect(document.activeElement?.getAttribute("data-path")).toBe(listing[0].path);
  });

  it("j walks past the edge of the window and focus follows the cursor", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.click(rows()[0]);
    for (let i = 0; i < 40; i += 1) fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(useInboxStore.getState().cursor).toBe(listing[40].path);
    expect(document.activeElement?.getAttribute("data-path")).toBe(listing[40].path);
    fireEvent.keyDown(document.activeElement as Element, { key: "k" });
    expect(document.activeElement?.getAttribute("data-path")).toBe(listing[39].path);
  });

  it("a cursor move re-renders the two rows it touches — also with everything selected (⌘A)", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.click(rows()[0]);
    rowRenders.length = 0;
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(rowRenders).toHaveLength(2);

    fireEvent.keyDown(document.activeElement as Element, { key: "a", metaKey: true });
    expect(useInboxStore.getState().selection).toHaveLength(N);
    expect(rows().every((el) => el.getAttribute("aria-selected") === "true")).toBe(true);
    rowRenders.length = 0;
    fireEvent.keyDown(document.activeElement as Element, { key: "j" });
    expect(rowRenders).toHaveLength(2);
    // Plain j leaves the selection alone; the cursor moved on.
    expect(useInboxStore.getState().selection).toHaveLength(N);
    expect(useInboxStore.getState().cursor).toBe(listing[2].path);
  });

  it("listing an unchanged folder again re-renders no row", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    const before = useInboxStore.getState();
    rowRenders.length = 0;
    await act(async () => {
      await useInboxStore.getState().load();
    });
    expect(listCalls).toBe(2);
    expect(rowRenders).toHaveLength(0);
    expect(useInboxStore.getState().items).toBe(before.items);
    expect(useInboxStore.getState().progress).toBe(before.progress);
  });

  it("a changed file re-renders its own row only, and a new arrival shows up while the list is open", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    rowRenders.length = 0;
    listing = listing.map((e, i) => (i === 3 ? { ...e, modified: e.modified + 1 } : e));
    await act(async () => {
      await useInboxStore.getState().load();
    });
    // Its own row and no other (twice: the new version, then its thumbnail).
    expect(new Set(rowRenders)).toEqual(new Set([listing[3].name]));

    const arrival = { name: "Just shared.html", path: `${INBOX}/Just shared.html`, is_directory: false, hidden: false, modified: Math.floor(Date.now() / 1000) + 60 };
    listing = [arrival, ...listing];
    await act(async () => {
      await useInboxStore.getState().load();
    });
    expect(screen.getByText("351 items · 351 unread")).toBeTruthy();
    expect(pathsOf(rows())[0]).toBe(arrival.path);
    expect(rows()[0].getAttribute("aria-setsize")).toBe("351");
  });

  it("marking one item read re-renders one row, and the sidecar write that follows re-renders none", async () => {
    let writes = 0;
    setMockInvokeHandler("write_file", () => {
      writes += 1;
    });
    renderWithProviders(<InboxView />);
    await mounted();
    rowRenders.length = 0;
    act(() => useInboxStore.getState().markRead([listing[2].path]));
    expect(rowRenders).toEqual([listing[2].name]);
    await waitFor(() => expect(writes).toBe(1), { timeout: 2000 });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(rowRenders).toEqual([listing[2].name]);
  });

  it("coming back to the list lands on the rows it was left at", async () => {
    const first = renderWithProviders(<InboxView />);
    await mounted();
    scrollTo(150 * 80);
    await waitFor(() => expect(pathsOf(rows())).toContain(listing[150].path));
    first.unmount();

    renderWithProviders(<InboxView />);
    await mounted();
    expect(scroller().scrollTop).toBe(150 * 80);
    expect(pathsOf(rows())).toContain(listing[150].path);
    expect(pathsOf(rows())).not.toContain(listing[30].path);
  });

  it("the gallery is windowed too: rows of cards, as many across as fit", async () => {
    useSettingsStore.setState({ inboxLayout: "gallery" });
    renderWithProviders(<InboxView />);
    await waitFor(() => expect(screen.queryAllByTestId("inbox-card").length).toBeGreaterThan(0));
    const cards = screen.getAllByTestId("inbox-card");
    const across = galleryColumns("medium", 900);
    expect(across).toBe(4);
    // Ten 80px rows of four on screen, plus overscan — not 350 cards.
    expect(cards.length).toBeLessThanOrEqual(24 * across);
    expect(cards.length % across === 0 || cards.length < N).toBe(true);
    expect(cards[0].getAttribute("aria-setsize")).toBe(String(N));
    expect(cards[1].getAttribute("aria-posinset")).toBe("2");
  });
});

describe("InboxView — one listing per open", () => {
  it("openInbox and the view's mount share one listing", async () => {
    act(() => useInboxStore.getState().openInbox());
    renderWithProviders(<InboxView />);
    await mounted();
    expect(listCalls).toBe(1);
  });

  it("a view that appears without openInbox still lists", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    expect(listCalls).toBe(1);
  });
});

describe("InboxView — one context menu for the list", () => {
  beforeEach(() => {
    listing = inboxListing(INBOX, 4);
  });

  it("acts on the row that was right-clicked", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.contextMenu(rows()[1]);
    fireEvent.click(await screen.findByRole("menuitem", { name: /Move to Trash/ }));
    await waitFor(() => expect(trashCalls).toEqual([[listing[1].path]]));
    await waitFor(() => expect(useInboxStore.getState().items).toHaveLength(3));
  });

  it("acts on the whole selection when the right-clicked row is part of it", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.click(rows()[0]);
    fireEvent.click(rows()[2], { metaKey: true });
    fireEvent.contextMenu(rows()[2]);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Pin/ }));
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([listing[0].path, listing[2].path]);
    // A row outside the selection is acted on alone, and the menu knows it
    // is not pinned while the others are.
    fireEvent.contextMenu(rows()[1]);
    fireEvent.click(await screen.findByRole("menuitem", { name: /^Pin/ }));
    expect(useWorkspaceStore.getState().pinnedFiles).toEqual([listing[0].path, listing[2].path, listing[1].path]);
    fireEvent.contextMenu(rows()[1]);
    expect(await screen.findByRole("menuitem", { name: /^Unpin/ })).toBeTruthy();
  });

  it("shows the item's own verbs: open original only once its header is known, mark read for an unread one", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.contextMenu(rows()[0]);
    expect(await screen.findByRole("menuitem", { name: "Open original in browser" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
    expect(useInboxStore.getState().unreadCount()).toBe(3);
  });

  it("opens nothing for a right-click that is not on an item", async () => {
    renderWithProviders(<InboxView />);
    await mounted();
    fireEvent.contextMenu(screen.getByText("Today"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
