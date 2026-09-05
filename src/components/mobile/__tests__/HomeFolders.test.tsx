// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders, screen, waitFor, fireEvent, setMockInvokeHandler } from "@/test/component-harness";
import { useMobileStore } from "@/stores/mobile-store";
import { HomeFolders } from "@/components/mobile/HomeFolders";

describe("Edit Home — a switch per root folder", () => {
  let disk: Record<string, string>;
  beforeEach(() => {
    useMobileStore.getState().reset();
    useMobileStore.setState({ grantState: "granted", libraryName: "Notesage" });
    disk = {};
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Writing", path: "Writing", is_directory: true, hidden: false },
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
      { name: ".notesage", path: ".notesage", is_directory: true, hidden: true },
      { name: "archive", path: "archive", is_directory: true, hidden: false },
      { name: "Inbox", path: "Inbox", is_directory: true, hidden: false },
    ]);
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
  });

  it("lists the root folders, Inbox first then alphabetical, files and hidden folders left out, switches from the file", async () => {
    useMobileStore.setState({ homeFolders: ["Inbox", "archive"] });
    renderWithProviders(<HomeFolders />);
    const switches = await screen.findAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-label"))).toEqual(["Inbox", "archive", "Writing"]);
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
  });

  it("with no file yet, only the Inbox is on", async () => {
    renderWithProviders(<HomeFolders />);
    const switches = await screen.findAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
  });

  it("a toggle writes home.json at once — no Save", async () => {
    renderWithProviders(<HomeFolders />);
    const writing = await screen.findByRole("switch", { name: "Writing" });
    fireEvent.click(writing);
    await waitFor(() => expect(disk[".notesage/home.json"]).toBeTruthy());
    expect(JSON.parse(disk[".notesage/home.json"]).folders).toEqual(["Inbox", "Writing"]);
    expect(writing.getAttribute("aria-checked")).toBe("true");
  });

  it("a failed write reverts the switch and says so", async () => {
    setMockInvokeHandler("ios_write_file", () => {
      throw new Error("iCloud is offline");
    });
    const { toast } = await import("sonner");
    renderWithProviders(<HomeFolders />);
    const writing = await screen.findByRole("switch", { name: "Writing" });
    fireEvent.click(writing);
    await waitFor(() => expect(vi.mocked(toast.error)).toHaveBeenCalled());
    await waitFor(() => expect(writing.getAttribute("aria-checked")).toBe("false"));
  });

  it("Back closes the screen", async () => {
    useMobileStore.getState().openHomeEditor();
    renderWithProviders(<HomeFolders />);
    await screen.findAllByRole("switch");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(useMobileStore.getState().homeEditorOpen).toBe(false);
  });
});
