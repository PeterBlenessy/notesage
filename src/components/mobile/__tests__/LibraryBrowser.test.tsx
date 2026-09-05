// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  setMockInvokeHandler,
} from "@/test/component-harness";
import { useMobileStore, resolveFolderView } from "@/stores/mobile-store";
import { LibraryBrowser } from "@/components/mobile/LibraryBrowser";
import type { FileEntry } from "@/lib/tauri";

interface CapturedChromeSpec {
  topRight?: {
    id: string;
    icon: string;
    menuOnTap?: boolean;
    menu?: Array<{ id: string; title: string; selected?: boolean; sectionBreak?: boolean }>;
  };
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useMobileStore.getState().reset();
  useMobileStore.setState({ grantState: "granted", libraryName: "Notesage" });
});

describe("Group by — Pinned (#652)", () => {
  it("declares Group by pinned in the menu's grouping section, checkmarked when active", async () => {
    useMobileStore.setState({ folderStack: [{ relPath: "", name: "All Folders" }] });
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });

    renderWithProviders(<LibraryBrowser />);
    await waitFor(() =>
      expect(captured.topRight?.menu?.some((m) => m.title === "Group by pinned")).toBe(true),
    );

    // Pinned joins the grouping section shipped in #664 (No grouping /
    // Recent / Date) rather than forming a second, parallel section.
    const groupSection = captured.topRight!.menu!.filter((m) =>
      m.title.startsWith("Group by") || m.title === "No grouping",
    );
    expect(groupSection.map((m) => m.title)).toEqual([
      "No grouping",
      "Group by pinned",
      "Group by recent",
      "Group by date",
      "Group by type",
    ]);
    // The grouping section opens with a divider, like the sort section.
    expect(groupSection[0].sectionBreak).toBe(true);
    expect(groupSection.map((m) => m.selected)).toEqual([true, false, false, false, false]);

    useMobileStore.getState().setGroupMode("pinned");
    await waitFor(() => {
      const section = captured.topRight!.menu!.filter((m) =>
        m.title.startsWith("Group by") || m.title === "No grouping",
      );
      expect(section.map((m) => m.selected)).toEqual([false, true, false, false, false]);
    });
  });

  it("with Pinned selected, renders a labeled Pinned section above the remaining entries in sort order", async () => {
    useMobileStore.setState({ folderStack: [{ relPath: "", name: "All Folders" }] });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "alpha.md", path: "alpha.md", is_directory: false, hidden: false },
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false },
      { name: "gamma.md", path: "gamma.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["beta.md"] }));

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("alpha.md");
    useMobileStore.getState().setGroupMode("pinned");

    await waitFor(() => expect(screen.getByText("Pinned")).toBeTruthy());
    const rowNames = () =>
      screen
        .getAllByRole("button", { name: /alpha\.md|beta\.md|gamma\.md/ })
        .map((b) => b.textContent);
    // The pinned entry surfaces first, then the rest in the existing
    // (alphabetical) sort order.
    expect(rowNames()[0]).toContain("beta.md");
    expect(rowNames()[1]).toContain("alpha.md");
    expect(rowNames()[2]).toContain("gamma.md");
  });

  it("with None selected, the flat list is unchanged — no Pinned heading, original order", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "alpha.md", path: "alpha.md", is_directory: false, hidden: false },
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => JSON.stringify({ paths: ["beta.md"] }));

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("alpha.md");

    expect(screen.queryByText("Pinned")).toBeNull();
    const rowNames = () =>
      screen.getAllByRole("button", { name: /alpha\.md|beta\.md/ }).map((b) => b.textContent);
    expect(rowNames()[0]).toContain("alpha.md");
    expect(rowNames()[1]).toContain("beta.md");
  });

  it("existing sort and view-mode behavior is unaffected when group-by is None", async () => {
    useMobileStore.setState({ folderStack: [{ relPath: "", name: "All Folders" }] });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false, modified: 300 },
      { name: "Alpha", path: "Alpha", is_directory: true, hidden: false, modified: 100 },
      { name: "zulu.md", path: "zulu.md", is_directory: false, hidden: false, modified: 200 },
    ]);
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("beta.md");
    const rowNames = () =>
      screen.getAllByRole("button", { name: /Alpha|beta\.md|zulu\.md/ }).map((b) => b.textContent);

    expect(rowNames()[0]).toContain("Alpha");
    expect(rowNames()[1]).toContain("beta.md");

    fireEvent.click(screen.getByRole("button", { name: "Sort by modified date" }));
    await waitFor(() => expect(rowNames()[0]).toContain("beta.md"));
    expect(resolveFolderView(useMobileStore.getState(), "").sortMode).toBe("modified");

    fireEvent.click(screen.getByRole("button", { name: "Switch to gallery view" }));
    await waitFor(() => expect(resolveFolderView(useMobileStore.getState(), "").viewMode).toBe("gallery"));
  });
});

describe("the view menu offers Condensed only where it changes something", () => {
  const menuIds = (spec: CapturedChromeSpec) => spec.topRight?.menu?.map((m) => m.id) ?? [];

  it("leaves Condensed out of a list of folders alone, and brings it back for files or the gallery", async () => {
    useMobileStore.setState({ folderStack: [{ relPath: "", name: "All Folders" }] });
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Ideas", path: "Ideas", is_directory: true, hidden: false, modified: 100 },
      { name: "Projects", path: "Projects", is_directory: true, hidden: false, modified: 100 },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Ideas");
    await waitFor(() => expect(menuIds(captured)).toContain("view-list"));
    expect(menuIds(captured)).not.toContain("view-condensed");

    // The gallery packs folder cards tighter, so there it does something.
    useMobileStore.getState().setViewMode("gallery");
    await waitFor(() => expect(menuIds(captured)).toContain("view-condensed"));
    useMobileStore.getState().setViewMode("list");
    await waitFor(() => expect(menuIds(captured)).not.toContain("view-condensed"));
  });

  it("offers Condensed in a list that has documents to condense", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Ideas", path: "Ideas", is_directory: true, hidden: false, modified: 100 },
      { name: "note.md", path: "note.md", is_directory: false, hidden: false, modified: 100 },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("note.md");
    await waitFor(() => expect(menuIds(captured)).toContain("view-condensed"));
  });
});

describe("deleting what is playing", () => {
  it("stops the article being read aloud when its file is deleted, before forgetting the path", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "keynote.md", path: "keynote.md", is_directory: false, hidden: false, modified: 100 },
    ]);
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_context_menu", () => "delete");
    setMockInvokeHandler("ios_delete_file", () => null);
    setMockInvokeHandler("ios_speech_stop", () => null);
    useMobileStore.setState({
      speech: { relPath: "keynote.md", title: "Keynote", playing: true, index: 3, total: 10, rate: 1, language: "en" },
      speechPositions: { "keynote.md": 3 },
    });
    renderWithProviders(<LibraryBrowser />);
    const row = await screen.findByRole("button", { name: /keynote\.md/ });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 0 });
    fireEvent.pointerMove(row, { clientX: 100, clientY: 0 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 0 });
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(useMobileStore.getState().speech).toBeNull());
    await waitFor(() => expect(useMobileStore.getState().speechPositions).toEqual({}));
  });
});

describe("Home — only the folders you chose", () => {
  const dir = (name: string, extra: Partial<FileEntry> = {}) => ({ name, path: name, is_directory: true, hidden: false, ...extra });
  const file = (name: string) => ({ name, path: name, is_directory: false, hidden: false });
  let disk: Record<string, string>;
  beforeEach(() => {
    disk = {};
    setMockInvokeHandler("ios_read_file", (args) => {
      const a = args as { relPath: string };
      if (a.relPath in disk) return disk[a.relPath];
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_write_file", (args) => {
      const a = args as { relPath: string; content: string };
      disk[a.relPath] = a.content;
    });
    setMockInvokeHandler("ios_ensure_directory", () => undefined);
    setMockInvokeHandler("ios_list_directory", () => [
      dir("Inbox", { child_count: 3 }),
      dir("Archive"),
      dir("Reading"),
      dir("Writing"),
      file("quick.md"),
    ]);
  });
  const rowNames = () => screen.getAllByRole("button").map((b) => b.textContent ?? "");

  it("without a file, Home is the Inbox, the root's files, the hint and All Folders — no folder rows", async () => {
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("quick.md");
    expect(screen.getByText("Inbox")).toBeTruthy();
    expect(screen.getByText("All Folders")).toBeTruthy();
    expect(screen.getByText(/Your folders are in All Folders/)).toBeTruthy();
    expect(screen.queryByText("Reading")).toBeNull();
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("with a file, Home shows exactly the chosen folders, alphabetical, and no hint", async () => {
    disk[".notesage/home.json"] = JSON.stringify({ version: 1, folders: ["Writing", "Reading", "Gone"] });
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Reading");
    expect(screen.getByText("Writing")).toBeTruthy();
    expect(screen.queryByText("Archive")).toBeNull();
    expect(screen.queryByText("Gone")).toBeNull(); // renamed on the Mac: dropped, no error
    expect(screen.queryByText(/Your folders are in All Folders/)).toBeNull();
    // The Inbox is not listed in the file, so its card is off.
    expect(screen.queryByText("Inbox")).toBeNull();
    const names = rowNames();
    expect(names.findIndex((n) => n.includes("Reading"))).toBeLessThan(names.findIndex((n) => n.includes("Writing")));
  });

  it("a search at Home looks through the whole root", async () => {
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("quick.md");
    window.dispatchEvent(new CustomEvent("notesage:chrome", { detail: { id: "search-query", value: "arch" } }));
    await screen.findByText("Archive");
    window.dispatchEvent(new CustomEvent("notesage:chrome", { detail: { id: "search-close" } }));
    await waitFor(() => expect(screen.queryByText("Archive")).toBeNull());
  });

  it("All Folders pushes the full root listing; Back returns to Home", async () => {
    renderWithProviders(<LibraryBrowser />);
    fireEvent.click(await screen.findByText("All Folders"));
    await screen.findByText("Archive");
    expect(screen.getByText("Reading")).toBeTruthy();
    expect(useMobileStore.getState().folderStack).toEqual([{ relPath: "", name: "All Folders" }]);
    expect(screen.queryByText("All Folders", { selector: "span" })).toBeNull();
    useMobileStore.getState().goBack();
    await waitFor(() => expect(screen.queryByText("Archive")).toBeNull());
    expect(await screen.findByText("All Folders")).toBeTruthy();
  });

  it("the hint goes with its × and stays gone", async () => {
    renderWithProviders(<LibraryBrowser />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(/Your folders are in All Folders/)).toBeNull());
    expect(useMobileStore.getState().homeHintDismissed).toBe(true);
  });

  it("offers Edit Home in the … menu at Home, not in All Folders; the row opens the editor", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(captured.topRight?.menu?.some((m) => m.id === "edit-home")).toBe(true));
    window.dispatchEvent(new CustomEvent("notesage:chrome", { detail: { id: "edit-home" } }));
    expect(useMobileStore.getState().homeEditorOpen).toBe(true);
    useMobileStore.getState().closeHomeEditor();
    useMobileStore.getState().enterFolder({ relPath: "", name: "All Folders" });
    await waitFor(() => expect(captured.topRight?.menu?.some((m) => m.id === "edit-home")).toBe(false));
  });

  it("an empty Home offers Choose folders…, still with All Folders beneath", async () => {
    setMockInvokeHandler("ios_list_directory", () => [dir("Archive"), dir("Reading")]);
    renderWithProviders(<LibraryBrowser />);
    fireEvent.click(await screen.findByRole("button", { name: "Choose folders…" }));
    expect(useMobileStore.getState().homeEditorOpen).toBe(true);
    expect(screen.getByText("All Folders")).toBeTruthy();
  });
});

describe("notifications on the phone", () => {
  const status = (over: Partial<{ authorization: "notDetermined" | "denied" | "authorized"; backgroundRefresh: "available" | "denied" | "restricted"; badge: boolean; newItems: boolean }> = {}) => ({
    authorization: "notDetermined" as const,
    backgroundRefresh: "available" as const,
    badge: false,
    newItems: false,
    ...over,
  });
  const inboxListing = () => [
    { name: "article.html", path: "Inbox/article.html", is_directory: false, hidden: false, modified: 100 },
  ];
  beforeEach(() => {
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_notification_set_prefs", () => status());
  });

  it("asks from a card on the Inbox once it holds an item — never on an empty Inbox, never once answered", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    useMobileStore.setState({ folderStack: [{ relPath: "Inbox", name: "Inbox" }] });
    const { unmount } = renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(useMobileStore.getState().notifications).not.toBeNull());
    expect(screen.queryByText("Know when new items arrive")).toBeNull();
    unmount();

    setMockInvokeHandler("ios_list_directory", inboxListing);
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("Know when new items arrive");
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByText("Know when new items arrive")).toBeNull());
    expect(useMobileStore.getState().notificationPrePromptDismissed).toBe(true);
  });

  it("Turn on spends the one system prompt", async () => {
    setMockInvokeHandler("ios_list_directory", inboxListing);
    let asked = 0;
    setMockInvokeHandler("ios_notification_request", () => {
      asked += 1;
      return status({ authorization: "authorized" });
    });
    setMockInvokeHandler("ios_notification_set_prefs", (args) => {
      const a = args as { badge?: boolean; newItems?: boolean };
      return status({ authorization: a.badge === undefined ? "notDetermined" : "authorized", badge: !!a.badge, newItems: !!a.newItems });
    });
    setMockInvokeHandler("ios_inbox_unread_count", () => 1);
    useMobileStore.setState({ folderStack: [{ relPath: "Inbox", name: "Inbox" }] });
    renderWithProviders(<LibraryBrowser />);
    fireEvent.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(useMobileStore.getState().notifications?.authorization).toBe("authorized"));
    expect(asked).toBe(1);
    await waitFor(() => expect(screen.queryByText("Know when new items arrive")).toBeNull());
  });

  it("shows no card when notifications were already decided", async () => {
    setMockInvokeHandler("ios_list_directory", inboxListing);
    setMockInvokeHandler("ios_notification_set_prefs", () => status({ authorization: "denied" }));
    useMobileStore.setState({ folderStack: [{ relPath: "Inbox", name: "Inbox" }] });
    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("article.html");
    await waitFor(() => expect(useMobileStore.getState().notifications?.authorization).toBe("denied"));
    expect(screen.queryByText("Know when new items arrive")).toBeNull();
  });

  it("the … menu carries the two preferences, the Settings row when denied, and the refresh row when off", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_list_directory", () => []);
    const rows = () => captured.topRight?.menu?.filter((m) => m.id.startsWith("notify-")).map((m) => [m.id, m.selected]) ?? [];
    setMockInvokeHandler("ios_notification_set_prefs", () => status({ authorization: "authorized", badge: true, newItems: false }));
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(rows()).toEqual([["notify-badge", true], ["notify-new", false]]));

    useMobileStore.setState({ notifications: status({ authorization: "denied" }) });
    await waitFor(() => expect(rows()).toEqual([["notify-settings", undefined]]));

    useMobileStore.setState({ notifications: status({ authorization: "authorized", backgroundRefresh: "denied" }) });
    await waitFor(() => expect(rows().map((r) => r[0])).toEqual(["notify-badge", "notify-new", "notify-refresh"]));

    useMobileStore.setState({ notifications: null });
    await waitFor(() => expect(rows()).toEqual([]));
  });

  it("a menu row toggles a preference, or asks first while iOS has not been asked", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    setMockInvokeHandler("ios_set_chrome", () => null);
    const prefCalls: Array<Record<string, unknown>> = [];
    setMockInvokeHandler("ios_notification_set_prefs", (args) => {
      prefCalls.push(args as Record<string, unknown>);
      const a = args as { newItems?: boolean };
      return status({ authorization: "authorized", newItems: a.newItems ?? false });
    });
    let asked = 0;
    setMockInvokeHandler("ios_notification_request", () => {
      asked += 1;
      return status({ authorization: "denied" });
    });
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(useMobileStore.getState().notifications?.authorization).toBe("authorized"));
    window.dispatchEvent(new CustomEvent("notesage:chrome", { detail: { id: "notify-new" } }));
    await waitFor(() => expect(useMobileStore.getState().notifications?.newItems).toBe(true));
    expect(prefCalls[prefCalls.length - 1]).toMatchObject({ newItems: true });

    useMobileStore.setState({ notifications: status({ authorization: "notDetermined" }) });
    // The action map follows the render; give React the turn to re-render.
    await new Promise((r) => setTimeout(r, 20));
    window.dispatchEvent(new CustomEvent("notesage:chrome", { detail: { id: "notify-badge" } }));
    await waitFor(() => expect(asked).toBe(1));
  });

  it("only the Inbox listing marks its items as seen; Home just counts", async () => {
    const calls: boolean[] = [];
    setMockInvokeHandler("ios_inbox_unread_count", (args) => {
      calls.push((args as { markSeen: boolean }).markSeen);
      return 0;
    });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Inbox", path: "Inbox", is_directory: true, hidden: false, child_count: 1 },
    ]);
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(calls).toEqual([false]));
    setMockInvokeHandler("ios_list_directory", inboxListing);
    useMobileStore.getState().jumpToFolder({ relPath: "Inbox", name: "Inbox" });
    await waitFor(() => expect(calls).toEqual([false, true]));
  });

  it("the Inbox card shows the unread count in the accent, the total otherwise", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Inbox", path: "Inbox", is_directory: true, hidden: false, child_count: 5 },
    ]);
    setMockInvokeHandler("ios_inbox_unread_count", () => 2);
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(screen.getByTestId("inbox-unread").textContent).toBe("2"));
    useMobileStore.setState({ unreadInbox: 0 });
    await waitFor(() => expect(screen.queryByTestId("inbox-unread")).toBeNull());
    expect(screen.getByText("5")).toBeTruthy();
  });
});

describe("recording from the library", () => {
  const capture = () => {
    let captured: CapturedChromeSpec & { bottomRight?: { id: string; menu?: Array<{ id: string }> }; bottomRecorder?: { elapsed: string; paused: boolean } } = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: typeof captured }).spec;
      return null;
    });
    return () => captured;
  };
  beforeEach(() => {
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_list_directory", () => []);
  });

  it("offers New Recording one hold away everywhere, and makes + record inside Recordings", async () => {
    const spec = capture();
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(spec().bottomRight?.id).toBe("create-folder"));
    expect(spec().bottomRight?.menu?.map((m) => m.id)).toEqual(["create-recording"]);
    useMobileStore.getState().enterFolder({ relPath: "Writing", name: "Writing" });
    await waitFor(() => expect(spec().bottomRight?.id).toBe("create-note"));
    expect(spec().bottomRight?.menu?.map((m) => m.id)).toEqual(["create-folder", "create-recording"]);
    useMobileStore.getState().jumpToFolder({ relPath: "Recordings", name: "Recordings" });
    await waitFor(() => expect(spec().bottomRight?.id).toBe("create-recording"));
    expect(spec().bottomRight?.menu?.map((m) => m.id)).toEqual(["create-note", "create-folder"]);
  });

  it("shows the island while recording, in place of the + button, and stops from it", async () => {
    const spec = capture();
    let stopped = 0;
    setMockInvokeHandler("ios_recording_stop", () => {
      stopped += 1;
      return { relPath: "Recordings/Recording 2026-09-05 14-02-11", manifest: "{}" };
    });
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(spec().bottomRight?.id).toBe("create-folder"));
    useMobileStore.getState().setRecording({ status: "recording", elapsedSecs: 134, level: 0.3 });
    await waitFor(() => expect(spec().bottomRecorder).toMatchObject({ elapsed: "02:14", paused: false }));
    expect(spec().bottomRight).toBeUndefined();
    window.dispatchEvent(new CustomEvent("notesage:chrome", { detail: { id: "rec-stop" } }));
    await waitFor(() => expect(stopped).toBe(1));
    await waitFor(() => expect(useMobileStore.getState().recording.status).toBe("idle"));
  });
});
