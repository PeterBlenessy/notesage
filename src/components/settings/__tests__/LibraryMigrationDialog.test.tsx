// @vitest-environment jsdom
//
// The migration dialog's phase machine, driven through the mocked IPC.
//
// Every other test of this feature stops below the UI: the planner and runner
// have unit tests, the rehearsal drives real files, the real-E2E drives real
// IPC. None of them can tell whether the dialog ever REACHES those functions,
// or whether the screen that refuses an undownloaded library can be left
// again. The pre-flight in particular is a gate — a gate wired to nothing
// looks exactly like a gate that always passes.

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderWithProviders, screen, waitFor, fireEvent } from "@/test/component-harness";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { LibraryMigrationDialog } from "@/components/settings/LibraryMigrationDialog";
import { useSettingsStore } from "@/stores/settings-store";

const OLD = "/lab/CloudDocs/Notesage";
const NEW = "/lab/Container/Documents";

/** A library with one loose note in the old root and an empty container. */
function seedRoots(over: { placeholders?: string[] } = {}) {
  setMockInvokeHandler("list_evicted_placeholders", () => over.placeholders ?? []);
  setMockInvokeHandler("icloud_ensure_downloaded", () => "downloading");
  setMockInvokeHandler("path_exists", (args) => {
    const path = (args as { path: string }).path;
    // A placeholder never materialises in these tests unless a case says so.
    if ((over.placeholders ?? []).includes(path)) return false;
    return path.endsWith("/.notesage") ? false : true;
  });
  setMockInvokeHandler("list_directory", (args) => {
    const path = (args as { path: string }).path;
    if (path === OLD) {
      return [
        { name: "Welcome.md", path: `${OLD}/Welcome.md`, is_directory: false, hidden: false },
      ];
    }
    return [];
  });
}

/**
 * Run the pre-flight's whole bounded wait without waiting for it.
 *
 * The dialog waits five minutes of one-second sweeps before it will call a
 * download stuck. That bound is the behaviour under test — an unbounded wait
 * leaves someone watching a bar that never moves — so the clock is faked and
 * wound forward rather than the bound being made smaller for the test's
 * convenience.
 */
async function runOutTheWait() {
  await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1000);
}

function render() {
  return renderWithProviders(
    <LibraryMigrationDialog open onOpenChange={vi.fn()} oldRoot={OLD} newRoot={NEW} />,
  );
}

describe("the library migration dialog", () => {
  beforeEach(() => {
    useSettingsStore.setState({ notesRootPath: "/lab/Notesage", homeDir: "/lab/home" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks iCloud BEFORE it shows a plan", async () => {
    // The order is the point. A placeholder is also a name already taken, so
    // planning against a half-downloaded library plans the wrong collisions —
    // the plan must not be built, let alone shown, until this passes.
    const calls: string[] = [];
    seedRoots();
    setMockInvokeHandler("list_evicted_placeholders", () => {
      calls.push("preflight");
      return [];
    });
    setMockInvokeHandler("list_directory", (args) => {
      calls.push("listing");
      return (args as { path: string }).path === OLD
        ? [{ name: "Welcome.md", path: `${OLD}/Welcome.md`, is_directory: false, hidden: false }]
        : [];
    });

    render();

    await waitFor(() => expect(screen.getByText(/1 projects|other files/i)).toBeTruthy());
    expect(calls[0]).toBe("preflight");
    expect(calls).toContain("listing");
  });

  it("refuses to offer the move while a file is still in iCloud", async () => {
    vi.useFakeTimers();
    seedRoots({ placeholders: [`${OLD}/Project/deep/old.md`] });

    render();
    await runOutTheWait();
    expect(screen.getByText(/still in iCloud/i)).toBeTruthy();
    // Named by path, so several stuck files with one name stay tellable apart.
    expect(screen.getByText("Project/deep/old.md")).toBeTruthy();
    // And crucially: no way to start the move from here.
    expect(screen.queryByText("Move the library")).toBeNull();
  });

  it("lets the refusal be retried once the file has arrived", async () => {
    // A gate with no way out is a dead end: the file may be seconds away.
    vi.useFakeTimers();
    let stillEvicted = true;
    seedRoots({ placeholders: [`${OLD}/late.md`] });
    setMockInvokeHandler("list_evicted_placeholders", () =>
      stillEvicted ? [`${OLD}/late.md`] : [],
    );

    render();
    await runOutTheWait();
    expect(screen.getByText(/still in iCloud/i)).toBeTruthy();

    // Back to the real clock: with nothing left to wait for, the re-run has
    // no timers to skip past.
    vi.useRealTimers();
    stillEvicted = false;
    fireEvent.click(screen.getByText("Check again"));

    expect(await screen.findByText("Move the library")).toBeTruthy();
  });

  it("stops waiting on request, and says what has not arrived", async () => {
    // On a large library over iCloud this can take a long time, and a modal
    // spinner with no way out is its own failure.
    seedRoots({ placeholders: [`${OLD}/huge.mov`] });

    render();

    // The wait is showing, with its way out.
    const stop = await screen.findByText("Stop waiting");
    fireEvent.click(stop);

    // Up to one sweep passes before the loop looks at the stop signal.
    await waitFor(() => expect(screen.getByText(/Waiting stopped/i)).toBeTruthy(), {
      timeout: 4000,
    });
    expect(screen.getByText("huge.mov")).toBeTruthy();
  });

  it("offers the way back once the move is done", async () => {
    // The undo record is written before the report is shown; without it the
    // offer must not appear, because there would be nothing behind it.
    seedRoots();
    const written: string[] = [];
    setMockInvokeHandler("write_file", (args) => {
      written.push((args as { path: string }).path);
      return undefined;
    });
    setMockInvokeHandler("create_directory", () => undefined);
    setMockInvokeHandler("migrate_library_entry", (args) => (args as { dst: string }).dst);
    setMockInvokeHandler("read_library_marker", () => null);
    setMockInvokeHandler("get_device_name", () => "A Mac");

    render();

    fireEvent.click(await screen.findByText("Move the library"));

    await waitFor(() => expect(screen.getByText("Move it back")).toBeTruthy());
    expect(written.some((p) => p.startsWith("/lab/home/.notesage/migrations/"))).toBe(true);
  });

  it("does not offer a way back it could not record", async () => {
    // Saving the record can fail — a full disk, a permissions fault. The
    // migration still succeeded, so it is not an error; but an "undo" button
    // with no record behind it would be a promise the app cannot keep.
    seedRoots();
    setMockInvokeHandler("write_file", (args) => {
      const path = (args as { path: string }).path;
      if (path.includes("/.notesage/migrations/")) throw new Error("disk full");
      return undefined;
    });
    setMockInvokeHandler("create_directory", () => undefined);
    setMockInvokeHandler("migrate_library_entry", (args) => (args as { dst: string }).dst);
    setMockInvokeHandler("read_library_marker", () => null);
    setMockInvokeHandler("get_device_name", () => "A Mac");

    render();

    fireEvent.click(await screen.findByText("Move the library"));

    await waitFor(() => expect(screen.getByText("Library moved")).toBeTruthy());
    expect(screen.queryByText("Move it back")).toBeNull();
    // And it says so rather than going quiet about it.
    expect(screen.getByText(/The way back/)).toBeTruthy();
  });
});
