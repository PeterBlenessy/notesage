// @vitest-environment jsdom
/**
 * useInboxArrivals — the Mac's side of Inbox notifications (PRD
 * 2026-09-05-ios-notifications, task #15).
 *
 * Loads are driven through the real `inbox-store.load()` against the Tauri
 * IPC mock so the baseline-then-diff is exercised end to end: a listing that
 * grows between two loads is an arrival; the first listing never is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@/test/tauri-mock";
import { renderHook, act } from "@testing-library/react";
import { setMockInvokeHandler, emitMockEvent } from "@/test/tauri-mock";

const notify = vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve());
vi.mock("@/lib/notifications", () => ({
  notify: (...args: unknown[]) => notify(...args),
}));

const setFocus = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus }),
}));

type ActionHandler = (n: { extra?: Record<string, unknown> }) => void;
const actionHandlers: ActionHandler[] = [];
const unregister = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({
  onAction: vi.fn(async (handler: ActionHandler) => {
    actionHandlers.push(handler);
    return { unregister };
  }),
}));

import { useInboxArrivals, arrivalNotification } from "@/hooks/useInboxArrivals";
import { useInboxStore, resetInboxCaches } from "@/stores/inbox-store";
import { useSettingsStore } from "@/stores/settings-store";

const INBOX = "/Users/peter/Notesage/Inbox";

function entry(name: string) {
  return { name, path: `${INBOX}/${name}`, is_directory: false, hidden: false };
}

let listing: string[] = [];
const watchDirectory = vi.fn<(args?: Record<string, unknown>) => void>(() => undefined);

async function load() {
  await act(async () => {
    await useInboxStore.getState().load();
  });
}

beforeEach(() => {
  resetInboxCaches();
  actionHandlers.length = 0;
  notify.mockClear();
  setFocus.mockClear();
  watchDirectory.mockClear();
  listing = [];
  useInboxStore.setState({
    open: false,
    dir: null,
    items: [],
    loading: false,
    error: null,
    progress: { version: 1, items: {} },
    meta: {},
  });
  useSettingsStore.setState({
    notesRootPath: "~/Notesage",
    homeDir: "/Users/peter",
    icloudNotesagePath: null,
    notifyInboxCaptures: true,
  });
  setMockInvokeHandler("allow_asset_dir", () => undefined);
  setMockInvokeHandler("list_files_shallow", () => listing.map(entry));
  setMockInvokeHandler("read_file", () => {
    throw new Error("no sidecar yet");
  });
  setMockInvokeHandler("inbox_card_meta", () => null);
  setMockInvokeHandler("watch_directory", (args) => watchDirectory(args));
  vi.spyOn(document, "hasFocus").mockReturnValue(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("useInboxArrivals — baseline then diff", () => {
  it("the first load is the baseline: a startup backlog notifies nothing", async () => {
    listing = ["a.html", "b.pdf", "c.md"];
    renderHook(() => useInboxArrivals());
    await load();
    expect(useInboxStore.getState().items).toHaveLength(3);
    expect(notify).not.toHaveBeenCalled();
  });

  it("a later load adding one name notifies once, with the item's title", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    listing = ["a.html", "How Tauri Works.html"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("inbox_capture", "New in Inbox", "How Tauri Works", { inbox: true });
  });

  it("uses the cached article header as the title when it is already known", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    listing = ["a.html", "capture-42.html"];
    setMockInvokeHandler("inbox_card_meta", (args) =>
      (args as { path: string }).path.endsWith("capture-42.html")
        ? { title: "A Proper Title", excerpt: null, minutes: null, site: null, sourceUrl: null }
        : null,
    );
    // The header lands in the store before the next listing completes only
    // when it was read earlier; seed it as the store would.
    useInboxStore.setState((s) => ({ meta: { ...s.meta, [`${INBOX}/capture-42.html`]: { title: "A Proper Title", excerpt: null, minutes: null, site: null, sourceUrl: null } } }));
    await load();
    expect(notify).toHaveBeenCalledWith("inbox_capture", "New in Inbox", "A Proper Title", { inbox: true });
  });

  it("three arrivals in one load notify once, as \"3 new in Inbox\"", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    listing = ["a.html", "one.html", "two.pdf", "three.md"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("inbox_capture", "3 new in Inbox", "one, two and 1 more", { inbox: true });
  });

  it("a load that adds nothing (a reload, an open) notifies nothing", async () => {
    listing = ["a.html", "b.pdf"];
    renderHook(() => useInboxArrivals());
    await load();
    await load();
    await act(async () => {
      useInboxStore.getState().openInbox();
    });
    await load();
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not re-announce what the user removed when a listing still shows it", async () => {
    listing = ["a.html", "b.pdf"];
    renderHook(() => useInboxArrivals());
    await load();
    // A trash / file-to removes b.pdf from the store outside a load; the
    // next listing (the folder still has it for a moment) must not call it new.
    act(() => {
      useInboxStore.setState((s) => ({ items: s.items.filter((i) => i.name !== "b.pdf") }));
    });
    await load();
    expect(notify).not.toHaveBeenCalled();
    // Something genuinely new still counts — and only it.
    listing = ["a.html", "b.pdf", "c.md"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("inbox_capture", "New in Inbox", "c", { inbox: true });
  });

  it("an empty listing (how the store reads a listing failure) keeps the baseline, so a backlog that blinks is not re-announced", async () => {
    listing = ["a.html", "b.pdf"];
    renderHook(() => useInboxArrivals());
    await load();
    setMockInvokeHandler("list_files_shallow", () => {
      throw new Error("disk blinked");
    });
    await load();
    expect(useInboxStore.getState().items).toEqual([]);
    setMockInvokeHandler("list_files_shallow", () => listing.map(entry));
    await load();
    expect(notify).not.toHaveBeenCalled();
    listing = ["a.html", "b.pdf", "c.md"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("inbox_capture", "New in Inbox", "c", { inbox: true });
  });

  it("a share into an EMPTY Inbox is announced — an empty first load is still the baseline", async () => {
    listing = [];
    renderHook(() => useInboxArrivals());
    await load();
    listing = ["first.html"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("inbox_capture", "New in Inbox", "first", { inbox: true });
  });
});

describe("useInboxArrivals — gates", () => {
  it("is suppressed while the window is focused AND the Inbox view is open", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    useInboxStore.setState({ open: true });
    listing = ["a.html", "b.html"];
    await load();
    expect(notify).not.toHaveBeenCalled();
  });

  it("still notifies when the window is focused but the Inbox is not in view", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    useInboxStore.setState({ open: false });
    listing = ["a.html", "b.html"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("still notifies when the Inbox is open but the window is in the background", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    useInboxStore.setState({ open: true });
    listing = ["a.html", "b.html"];
    await load();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("is suppressed when the setting is off", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    useSettingsStore.setState({ notifyInboxCaptures: false });
    listing = ["a.html", "b.html"];
    await load();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("useInboxArrivals — the click handler", () => {
  it("opens the Inbox and focuses the window for a notification carrying extra.inbox", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    expect(actionHandlers).toHaveLength(1);
    await act(async () => {
      actionHandlers[0]({ extra: { inbox: true } });
    });
    expect(useInboxStore.getState().open).toBe(true);
    expect(setFocus).toHaveBeenCalledTimes(1);
  });

  it("ignores other notifications (a session's conversationId is not ours)", async () => {
    renderHook(() => useInboxArrivals());
    await act(async () => {});
    actionHandlers[0]({ extra: { conversationId: "conv-A" } });
    actionHandlers[0]({});
    expect(useInboxStore.getState().open).toBe(false);
    expect(setFocus).not.toHaveBeenCalled();
  });

  it("unregisters the handler on unmount", async () => {
    const { unmount } = renderHook(() => useInboxArrivals());
    await act(async () => {});
    unmount();
    expect(unregister).toHaveBeenCalled();
  });
});

describe("useInboxArrivals — the folder watch (moved out of InboxSection)", () => {
  it("watches the Inbox folder once its path is known", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    expect(watchDirectory).toHaveBeenCalledWith({ path: INBOX });
    expect(watchDirectory).toHaveBeenCalledTimes(1);
    await load();
    expect(watchDirectory).toHaveBeenCalledTimes(1);
  });

  it("reloads (debounced) on a change under the folder and announces the arrival", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    vi.useFakeTimers();
    listing = ["a.html", "fresh.html"];
    emitMockEvent("file-changed-batch", [{ path: `${INBOX}/fresh.html`, kind: "create" }]);
    emitMockEvent("file-changed-batch", [{ path: `${INBOX}/fresh.html`, kind: "modify" }]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    await act(async () => {});
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(["a.html", "fresh.html"]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("inbox_capture", "New in Inbox", "fresh", { inbox: true });
  });

  it("ignores the sidecar's own writes and changes elsewhere", async () => {
    listing = ["a.html"];
    renderHook(() => useInboxArrivals());
    await load();
    vi.useFakeTimers();
    listing = ["a.html", "should-not-load.html"];
    emitMockEvent("file-changed-batch", [
      { path: `${INBOX}/.notesage/reading-progress.json`, kind: "modify" },
      { path: "/Users/peter/Notesage/Other/note.md", kind: "modify" },
    ]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    vi.useRealTimers();
    expect(useInboxStore.getState().items.map((i) => i.name)).toEqual(["a.html"]);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe("arrivalNotification", () => {
  const item = (name: string) => ({ name, path: `${INBOX}/${name}`, kind: "html" as const });

  it("one item: the filename stem", () => {
    expect(arrivalNotification([item("Some Article.html")], {})).toEqual({ title: "New in Inbox", body: "Some Article" });
  });

  it("one item: the cached header wins over the stem", () => {
    const meta = { [`${INBOX}/x.html`]: { title: "Header", excerpt: null, minutes: null, site: null, sourceUrl: null } };
    expect(arrivalNotification([item("x.html")], meta).body).toBe("Header");
  });

  it("two items: both named", () => {
    expect(arrivalNotification([item("a.md"), item("b.md")], {})).toEqual({ title: "2 new in Inbox", body: "a and b" });
  });

  it("five items: two named and the rest counted", () => {
    expect(arrivalNotification(["a", "b", "c", "d", "e"].map((n) => item(`${n}.md`)), {})).toEqual({
      title: "5 new in Inbox",
      body: "a, b and 3 more",
    });
  });
});
