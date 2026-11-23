// @vitest-environment jsdom

/**
 * The Recordings view against a backend that behaves like the Rust one
 * (audit 2026-11-22 §10): `list_files_shallow` never returns a directory, a
 * recording bundle IS a directory, and a failed read is not an empty folder.
 */

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, renderWithProviders, screen, waitFor } from "@/test/component-harness";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { RecordingsView } from "@/components/recordings/RecordingsView";
import { useRecordingsStore } from "@/stores/recordings-store";
import { useSettingsStore } from "@/stores/settings-store";

vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({ openFile: vi.fn() }),
}));

const DIR = "/Users/peter/Notesage/Recordings";
const BUNDLE = `${DIR}/Recording 2026-09-05 12-04-00`;

interface Entry {
  name: string;
  path: string;
  is_directory: boolean;
  hidden: boolean;
}

/** What is in `Recordings/`: one bundle folder and one stray file. */
const ON_DISK: Entry[] = [
  { name: "Recording 2026-09-05 12-04-00", path: BUNDLE, is_directory: true, hidden: false },
  { name: "notes.txt", path: `${DIR}/notes.txt`, is_directory: false, hidden: false },
];

describe("RecordingsView", () => {
  beforeEach(() => {
    useRecordingsStore.setState({ open: true, dir: null, bundles: [], error: null, loading: false });
    useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter" });
    // The Rust commands: the shallow listing drops directories, the full one keeps them.
    setMockInvokeHandler("list_files_shallow", () => ON_DISK.filter((e) => !e.is_directory));
    setMockInvokeHandler("list_directory", () => ON_DISK);
    setMockInvokeHandler("read_file", () => {
      throw new Error("no manifest");
    });
    setMockInvokeHandler("path_exists", (args) => String(args?.path) === DIR);
  });

  it("lists a bundle that exists on disk, although the shallow listing omits directories", async () => {
    renderWithProviders(<RecordingsView />);

    const list = await screen.findByTestId("recordings-list");
    expect(list.querySelectorAll("li")).toHaveLength(1);
    expect(list.textContent).toContain("Recording 2026-09-05 12-04-00");
  });

  it("shows a read failure as an error, not as 'No recordings yet'", async () => {
    setMockInvokeHandler("list_directory", () => {
      throw new Error(`Failed to read directory ${DIR}: Operation not permitted`);
    });

    renderWithProviders(<RecordingsView />);

    const alert = await screen.findByTestId("recordings-error");
    expect(alert.textContent).toContain("Operation not permitted");
    expect(screen.queryByText("No recordings yet")).toBeNull();
    expect(useRecordingsStore.getState().error).toContain("Operation not permitted");
  });

  it("the error offers a retry that loads the list once the read works", async () => {
    let fail = true;
    setMockInvokeHandler("list_directory", () => {
      if (fail) throw new Error("busy");
      return ON_DISK;
    });

    renderWithProviders(<RecordingsView />);
    await screen.findByTestId("recordings-error");

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByTestId("recordings-list");
    expect(screen.queryByTestId("recordings-error")).toBeNull();
  });

  it("a Recordings folder that does not exist yet is still the ordinary empty state", async () => {
    setMockInvokeHandler("list_directory", () => {
      throw new Error(`Path is not a directory: ${DIR}`);
    });
    setMockInvokeHandler("path_exists", () => false);

    renderWithProviders(<RecordingsView />);

    await waitFor(() => expect(screen.getByText("No recordings yet")).toBeTruthy());
    expect(screen.queryByTestId("recordings-error")).toBeNull();
    expect(useRecordingsStore.getState().error).toBeNull();
  });
});
