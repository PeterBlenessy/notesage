// @vitest-environment jsdom
//
// The Settings row that offers — or does not offer — the library move.
//
// It used to render a button when the move was available and NOTHING at all
// otherwise: four different situations showing the same blank space. Somebody
// who had just turned the Labs flag on could not tell a broken feature from a
// Mac that simply is not eligible, and that is exactly what happened. Every
// case below asserts the row says which one it is.

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderWithProviders, screen, waitFor } from "@/test/component-harness";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { LibraryMigrationRow } from "@/components/settings/LibraryMigrationRow";
import { useSettingsStore } from "@/stores/settings-store";
import { useFlagStore } from "@/stores/flag-store";

const ICLOUD = "/Users/x/Library/Mobile Documents/com~apple~CloudDocs";
const CONTAINER = "/Users/x/Library/Mobile Documents/iCloud~com~notesage~app/Documents";

/** The three filesystem answers the row's eligibility check depends on. */
function seed(over: {
  container?: string | null;
  access?: "missing" | "denied" | "ready";
  icloud?: string | null;
  migrated?: boolean;
  oldHasContent?: boolean;
} = {}) {
  setMockInvokeHandler("get_icloud_path", () =>
    over.icloud === undefined ? ICLOUD : over.icloud,
  );
  setMockInvokeHandler("get_library_container_path", () =>
    over.container === undefined ? CONTAINER : over.container,
  );
  setMockInvokeHandler("read_library_marker", () =>
    over.migrated
      ? {
          version: 1,
          kind: "container",
          createdBy: "ios",
          createdAt: "2026-09-01T10:00:00.000Z",
          migratedFrom: "com~apple~CloudDocs/Notesage",
        }
      : null,
  );
  setMockInvokeHandler("list_directory", () =>
    over.oldHasContent === false ? [] : [{ name: "Welcome.md", path: "x", is_directory: false, hidden: false }],
  );
  setMockInvokeHandler("library_container_access", () =>
    over.access ?? (over.container === null ? "missing" : "ready"),
  );
  setMockInvokeHandler("path_exists", () => false);
}

function render() {
  return renderWithProviders(
    <LibraryMigrationRow onReview={vi.fn()} onUndo={vi.fn()} />,
  );
}

describe("the synced-library settings row", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      icloudNotesagePath: `${ICLOUD}/Notesage`,
      libraryRootKind: "clouddocs",
      homeDir: "/Users/x",
    });
    useFlagStore.setState({ enabled: ["icloud-container-library"] });
  });

  it("names the place AND shows the path, because neither alone is the answer", () => {
    // "iCloud Drive/Notesage" is where it is; the full path is which folder
    // exactly. Nobody reads `com~apple~CloudDocs` as "iCloud Drive".
    seed();
    render();

    expect(screen.getByText("iCloud Drive/Notesage")).toBeTruthy();
    expect(screen.getByText(`${ICLOUD}/Notesage`)).toBeTruthy();
  });

  it("offers the move, and says what it is for", async () => {
    seed();
    render();

    expect(await screen.findByText("Move…")).toBeTruthy();
    expect(screen.getByText(/iPhone app can open them without you/)).toBeTruthy();
  });

  it("explains a missing container instead of showing nothing", async () => {
    // The common case on a second Mac, and the one that read as "the feature
    // is broken": the folder is made by the iPhone and brought here by
    // iCloud, and this Mac deliberately never creates it.
    seed({ container: null });
    render();

    await waitFor(() => expect(screen.getByText(/has not reached this Mac yet/)).toBeTruthy());
    expect(screen.queryByText("Move…")).toBeNull();
  });

  it("says the move is already done rather than going quiet", async () => {
    seed({ migrated: true });
    render();

    await waitFor(() =>
      expect(screen.getByText(/already in Notesage's own iCloud folder/)).toBeTruthy(),
    );
    expect(screen.queryByText("Move…")).toBeNull();
  });

  it("tells you to grant Full Disk Access when macOS is blocking the folder", async () => {
    // The folder is THERE — the iPhone made it and iCloud synced it down —
    // and macOS refuses the read. Before this, the app offered the move on
    // the strength of the folder existing and died on the first real read
    // with an errno.
    seed({ access: "denied" });
    render();

    await waitFor(() => expect(screen.getByText(/Full Disk Access/)).toBeTruthy());
    expect(screen.queryByText("Move…")).toBeNull();
    // And not the "hasn't arrived yet" text, which has the wrong remedy.
    expect(screen.queryByText(/has not reached this Mac yet/)).toBeNull();
  });

  it("does not read the marker through a folder it cannot read", async () => {
    // The marker read fails under a denial too, and catching it would report
    // "no marker" — which reads as "not migrated yet".
    let markerReads = 0;
    seed({ access: "denied" });
    setMockInvokeHandler("read_library_marker", () => {
      markerReads += 1;
      return null;
    });
    render();

    await waitFor(() => expect(screen.getByText(/Full Disk Access/)).toBeTruthy());
    expect(markerReads).toBe(0);
  });

  it("says iCloud is off when there is no synced library at all", async () => {
    seed({ icloud: null });
    render();

    await waitFor(() => expect(screen.getByText(/iCloud sync is off/)).toBeTruthy());
  });

  it("explains nothing at all until the flag is on", () => {
    // The explanations answer a question nobody has asked yet. Without the
    // flag the row is just "here is where your library is".
    useFlagStore.setState({ enabled: [] });
    seed();
    render();

    expect(screen.queryByText(/iPhone app can open them/)).toBeNull();
    expect(screen.queryByText(/has not reached this Mac yet/)).toBeNull();
    expect(screen.getByText("iCloud Drive/Notesage")).toBeTruthy();
  });
});
