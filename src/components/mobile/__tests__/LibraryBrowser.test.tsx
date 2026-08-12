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
import { useMobileStore } from "@/stores/mobile-store";
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

describe("Group by — Recent (#656)", () => {
  it("declares a Group by section (Recent, None) with checkmark selection reflecting groupByMode", async () => {
    let captured: CapturedChromeSpec = {};
    setMockInvokeHandler("ios_set_chrome", (args) => {
      captured = (args as { spec: CapturedChromeSpec }).spec;
      return null;
    });
    setMockInvokeHandler("ios_list_directory", () => []);

    renderWithProviders(<LibraryBrowser />);
    await waitFor(() =>
      expect(captured.topRight?.menu?.some((m) => m.title === "Recent")).toBe(true),
    );

    const groupSection = captured.topRight!.menu!.filter(
      (m) => m.title === "Recent" || m.title === "None",
    );
    expect(groupSection.map((m) => m.title)).toEqual(["Recent", "None"]);
    // The Group by section starts with a divider, matching the sort section's pattern.
    expect(groupSection[0].sectionBreak).toBe(true);
    expect(groupSection.map((m) => m.selected)).toEqual([false, true]);

    useMobileStore.getState().setGroupByMode("recent");
    await waitFor(() => {
      const section = captured.topRight!.menu!.filter(
        (m) => m.title === "Recent" || m.title === "None",
      );
      expect(section.map((m) => m.selected)).toEqual([true, false]);
    });
  });

  it("with Recent selected, renders a labeled Recent section (most-recent first) above the remaining entries in sort order", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "alpha.md", path: "alpha.md", is_directory: false, hidden: false },
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false },
      { name: "gamma.md", path: "gamma.md", is_directory: false, hidden: false },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("alpha.md");
    // Seed recency: beta opened, then gamma opened more recently.
    useMobileStore.getState().openDocument({ relPath: "beta.md", name: "beta.md" });
    useMobileStore.getState().openDocument({ relPath: "gamma.md", name: "gamma.md" });
    useMobileStore.getState().closeDocument();
    useMobileStore.getState().setGroupByMode("recent");

    await waitFor(() => expect(screen.getByText("Recent")).toBeTruthy());
    const rowNames = () =>
      screen
        .getAllByRole("button", { name: /alpha\.md|beta\.md|gamma\.md/ })
        .map((b) => b.textContent);
    // Recent entries come first, most-recently-read first (gamma, then beta),
    // followed by the remaining entry in the existing (alphabetical) sort order.
    expect(rowNames()[0]).toContain("gamma.md");
    expect(rowNames()[1]).toContain("beta.md");
    expect(rowNames()[2]).toContain("alpha.md");
  });

  it("with None selected, the flat list is unchanged — no Recent heading, original order", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "alpha.md", path: "alpha.md", is_directory: false, hidden: false },
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("alpha.md");
    useMobileStore.getState().openDocument({ relPath: "beta.md", name: "beta.md" });
    useMobileStore.getState().closeDocument();

    expect(screen.queryByText("Recent")).toBeNull();
    const rowNames = () =>
      screen.getAllByRole("button", { name: /alpha\.md|beta\.md/ }).map((b) => b.textContent);
    expect(rowNames()[0]).toContain("alpha.md");
    expect(rowNames()[1]).toContain("beta.md");
  });

  it("group modes are mutually exclusive — switching to Recent then back to None never combines groups", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "alpha.md", path: "alpha.md", is_directory: false, hidden: false },
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("alpha.md");
    useMobileStore.getState().openDocument({ relPath: "beta.md", name: "beta.md" });
    useMobileStore.getState().closeDocument();

    useMobileStore.getState().setGroupByMode("recent");
    await waitFor(() => expect(screen.getByText("Recent")).toBeTruthy());
    expect(useMobileStore.getState().groupByMode).toBe("recent");

    useMobileStore.getState().setGroupByMode("none");
    await waitFor(() => expect(screen.queryByText("Recent")).toBeNull());
    // A single-value union field structurally prevents both group modes
    // being active at once — verified here at the state layer too.
    expect(useMobileStore.getState().groupByMode).toBe("none");
  });

  it("existing sort and view-mode behavior is unaffected when group-by is None", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "beta.md", path: "beta.md", is_directory: false, hidden: false, modified: 300 },
      { name: "Alpha", path: "Alpha", is_directory: true, hidden: false, modified: 100 },
      { name: "zulu.md", path: "zulu.md", is_directory: false, hidden: false, modified: 200 },
    ]);

    renderWithProviders(<LibraryBrowser />);
    await screen.findByText("beta.md");
    const rowNames = () =>
      screen.getAllByRole("button", { name: /Alpha|beta\.md|zulu\.md/ }).map((b) => b.textContent);

    expect(rowNames()[0]).toContain("Alpha");
    expect(rowNames()[1]).toContain("beta.md");

    fireEvent.click(screen.getByRole("button", { name: "Sort by modified date" }));
    await waitFor(() => expect(rowNames()[0]).toContain("beta.md"));
    expect(useMobileStore.getState().sortMode).toBe("modified");

    fireEvent.click(screen.getByRole("button", { name: "Switch to gallery view" }));
    await waitFor(() => expect(useMobileStore.getState().viewMode).toBe("gallery"));
  });
});
