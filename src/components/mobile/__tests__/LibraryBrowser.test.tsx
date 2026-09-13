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

describe("the view menu offers Condensed wherever there are rows", () => {
  const menuIds = (spec: CapturedChromeSpec) => spec.topRight?.menu?.map((m) => m.id) ?? [];

  it("offers Condensed for a list of folders too — native rows change with it", async () => {
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
    // This used to assert the OPPOSITE — that a list of folders alone gets no
    // Condensed, since there would be nothing to condense. True of the web
    // rows this was written for; false of the native ones, where condensed
    // halves the tile (72pt → 40) and the row height (88 → 56) for every row,
    // a folder included. A library whose root holds only folders lost the
    // option on Home for no reason (Peter, build 71).
    expect(menuIds(captured)).toContain("view-condensed");

    useMobileStore.getState().setViewMode("gallery");
    await waitFor(() => expect(menuIds(captured)).toContain("view-condensed"));
    useMobileStore.getState().setViewMode("list");
    await waitFor(() => expect(menuIds(captured)).toContain("view-condensed"));
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

// Home's own behaviour — the curated set, the cards, the hint, All Folders —
// moved to `LibraryFolderScreen` (#1000 step 4). The curation rules are tested
// in `scripts/library-ordering-check`, against the same Swift the app runs.


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

describe("the notification rows in the … menu", () => {
  // Live on every device — the menu is declared whether or not the rows are
  // drawn natively — and left with no test at all when the web Home's suites
  // went. A regression here is silent: the toggle looks like it worked.
  const menuIds = (spec: CapturedChromeSpec) => spec.topRight?.menu?.map((m) => m.id) ?? [];

  function setup(notifications: Record<string, unknown>) {
    useMobileStore.setState({ folderStack: [{ relPath: "Inbox", name: "Inbox" }] });
    // The component asks the native side on mount and overwrites whatever the
    // store held, so the state under test has to come from there.
    setMockInvokeHandler("ios_notification_status", () => notifications);
    setMockInvokeHandler("ios_notification_set_prefs", () => notifications);
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "a.md", path: "Inbox/a.md", is_directory: false, hidden: false, modified: 1 },
    ]);
    return () => captured;
  }

  it("shows each preference's current state as its checkmark", async () => {
    const captured = setup({ authorization: "authorized", badge: true, newItems: false });
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(menuIds(captured())).toContain("notify-badge"));
    const rows = captured().topRight!.menu!;
    expect(rows.find((m) => m.id === "notify-badge")?.selected).toBe(true);
    expect(rows.find((m) => m.id === "notify-new")?.selected).toBe(false);
  });

  it("asks iOS first when permission has never been requested", async () => {
    // The order matters: toggling a preference before the grant exists sets
    // something the system will ignore, and the row then lies about its state.
    const asked: string[] = [];
    setMockInvokeHandler("ios_notification_request", () => {
      asked.push("request");
      return { authorization: "denied", badge: false, newItems: false };
    });
    setMockInvokeHandler("ios_notification_set_prefs", () => {
      asked.push("set");
      return { authorization: "denied", badge: false, newItems: false };
    });
    const captured = setup({ authorization: "notDetermined", badge: false, newItems: false });
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(menuIds(captured())).toContain("notify-badge"));

    // Drive the handler the native menu row would call.
    fireEvent(window, new CustomEvent("notesage:chrome", { detail: { id: "notify-badge" } }));
    await waitFor(() => expect(asked[0]).toBe("request"));
    // Denied: nothing is written, because there is nothing to write to.
    expect(asked).not.toContain("set");
  });
});

describe("only the Inbox listing marks its items seen", () => {
  // Home shows a NUMBER; the Inbox shows the items. Listing Home must recount
  // without clearing the badge, or the count vanishes from a screen that
  // never showed anything. The store-level call kept its test when the web
  // Home went; this wiring — which screen passes `true` — lost its only one.
  function listing(relPath: string) {
    useMobileStore.setState({
      folderStack: relPath === "" ? [] : [{ relPath, name: relPath }],
    });
    const marked: boolean[] = [];
    setMockInvokeHandler("ios_inbox_unread_count", (args) => {
      marked.push((args as { markSeen?: boolean }).markSeen === true);
      return 3;
    });
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not found");
    });
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "a.md", path: `${relPath ? relPath + "/" : ""}a.md`, is_directory: false, hidden: false, modified: 1 },
    ]);
    return marked;
  }

  it("marks them seen when the Inbox itself is listed", async () => {
    const marked = listing("Inbox");
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(marked.length).toBeGreaterThan(0));
    expect(marked).toContain(true);
  });

  it("counts but does NOT mark them seen when Home is listed", async () => {
    const marked = listing("");
    renderWithProviders(<LibraryBrowser />);
    await waitFor(() => expect(marked.length).toBeGreaterThan(0));
    expect(marked).not.toContain(true);
  });
});
