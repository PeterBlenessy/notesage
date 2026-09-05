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
