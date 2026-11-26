// @vitest-environment jsdom

/**
 * The Recordings view against an in-memory Recordings folder, with the real
 * store, the real job hook and the real file helpers underneath.
 *
 * (Audit 2026-11-22 §10 is still pinned here: `list_files_shallow` never
 * returns a directory, a recording bundle IS a directory, and a failed read
 * is not an empty folder.)
 */

import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { act, fireEvent, renderWithProviders, screen, waitFor, within } from "@/test/component-harness";
import { emitMockEvent, setMockInvokeHandler } from "@/test/tauri-mock";
import { RECORDINGS_DIR, addBundle, installFakeDisk, type FakeDisk } from "@/test/fake-recordings-disk";
import { RecordingsView, WINDOW_THRESHOLD, matchesRecording } from "@/components/recordings/RecordingsView";
import { __resetRecordingsStoreMemory, useRecordingsStore, type RecordingBundle } from "@/stores/recordings-store";
import { useActivityStore } from "@/stores/activity-store";
import { useRecordingStore } from "@/stores/recording-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useTranscriptionJob } from "@/hooks/useTranscriptionJob";
import { setLocale } from "@/lib/i18n";
import { parseRecordingManifest } from "@/lib/transcription/manifest";
import { parseSegmentsFile } from "@/lib/transcription/segments";
import { writeTranscript } from "@/lib/transcription/transcript-files";
import { stubInboxLayout, type InboxLayoutStub } from "@/components/inbox/__tests__/inbox-layout-stub";
import type { TranscriptionResult } from "@/lib/tauri";

const { openFileMock, toggleRecordingMock } = vi.hoisted(() => ({
  openFileMock: vi.fn<(path: string, name: string) => Promise<void>>(async () => undefined),
  toggleRecordingMock: vi.fn<() => Promise<void>>(async () => undefined),
}));
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({ openFile: openFileMock }),
}));
vi.mock("@/hooks/useMeetingRecording", () => ({
  toggleMeetingRecording: () => toggleRecordingMock(),
}));

const toastError = toast.error as ReturnType<typeof vi.fn>;
const toastSuccess = toast.success as ReturnType<typeof vi.fn>;

// Radix menus and dialogs use DOM APIs jsdom lacks.
for (const m of ["hasPointerCapture", "releasePointerCapture", "setPointerCapture", "scrollIntoView"] as const) {
  if (!(m in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, m, { configurable: true, value: vi.fn(() => false) });
  }
}
if (!("ResizeObserver" in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}

const FIXTURES = join(__dirname, "../../../lib/transcription/__tests__/fixtures");
const VTT = readFileSync(join(FIXTURES, "teams-meeting.vtt"), "utf8");
const OURS = parseSegmentsFile(readFileSync(join(FIXTURES, "teams-meeting.segments.json"), "utf8"))!;

const NAME = "Recording 2026-09-05 14-02-11";
let disk: FakeDisk;
let layout: InboxLayoutStub | null = null;

function rows(): HTMLElement[] {
  return screen.queryAllByTestId("recording-row");
}
function rowFor(title: string): HTMLElement {
  const found = rows().find((row) => within(row).queryByRole("heading", { name: title }));
  if (!found) throw new Error(`no row titled ${title}`);
  return found;
}
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(trigger, { button: 0 });
    fireEvent.click(trigger);
  });
}
async function pick(name: string | RegExp) {
  const item = await screen.findByRole("menuitem", { name });
  act(() => {
    fireEvent.click(item);
  });
}
async function mountView() {
  const view = renderWithProviders(<RecordingsView />);
  await waitFor(() => expect(useRecordingsStore.getState().loading).toBe(false));
  return view;
}
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  __resetRecordingsStoreMemory();
  disk = installFakeDisk();
  useRecordingsStore.setState({ open: true, dir: null, bundles: [], error: null, loading: false, imports: [], rootOverride: null });
  useActivityStore.setState({ tasks: [] });
  useWorkspaceStore.setState({ projects: [] });
  useRecordingStore.setState({
    isRecording: false,
    defaultModel: "small",
    speechLanguage: "sv",
    availableModels: [
      { name: "small", size_bytes: 1, downloaded: true },
      { name: "large-v3", size_bytes: 3, downloaded: true },
      { name: "medium", size_bytes: 2, downloaded: false },
    ],
  } as Partial<ReturnType<typeof useRecordingStore.getState>>);
  useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter", icloudNotesagePath: null });
});

afterEach(() => {
  layout?.restore();
  layout = null;
  setLocale(null);
});

// ===========================================================================
// Listing
// ===========================================================================

describe("RecordingsView — the list", () => {
  it("lists a bundle that exists on disk, although the shallow listing omits directories", async () => {
    addBundle(disk, NAME);
    disk.files.set(`${RECORDINGS_DIR}/notes.txt`, "a stray file");
    await mountView();

    const list = screen.getByTestId("recordings-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(list.textContent).toContain(NAME);
    expect(disk.count("list_files_shallow")).toBe(0);
  });

  it("shows a read failure as an error, not as 'No recordings yet', and retries", async () => {
    let fail = true;
    addBundle(disk, NAME);
    const real = disk.calls;
    setMockInvokeHandler("list_directory", (args) => {
      real.push({ cmd: "list_directory", args: args ?? {} });
      if (fail) throw new Error(`Failed to read directory ${RECORDINGS_DIR}: Operation not permitted`);
      return [
        {
          name: NAME,
          path: `${RECORDINGS_DIR}/${NAME}`,
          is_directory: true,
          hidden: false,
          children: [
            { name: "audio.m4a", path: `${RECORDINGS_DIR}/${NAME}/audio.m4a`, is_directory: false, hidden: false },
            { name: "recording.json", path: `${RECORDINGS_DIR}/${NAME}/recording.json`, is_directory: false, hidden: false },
          ],
        },
      ];
    });
    await mountView();

    const alert = screen.getByTestId("recordings-error");
    expect(alert.textContent).toContain("Operation not permitted");
    expect(screen.queryByText("No recordings yet")).toBeNull();

    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByTestId("recordings-list");
    expect(screen.queryByTestId("recordings-error")).toBeNull();
  });

  // U4: starting a recording was hidden behind the orb; the empty view offered nothing.
  it("a Recordings folder that does not exist yet is the ordinary empty state, with Record and Import", async () => {
    disk.dirs.clear();
    await mountView();

    const empty = screen.getByTestId("recordings-empty");
    expect(empty.textContent).toContain("No recordings yet");
    expect(screen.queryByTestId("recordings-error")).toBeNull();
    expect(within(empty).getByRole("button", { name: "Record" })).toBeTruthy();
    expect(within(empty).getByRole("button", { name: "Import recording…" })).toBeTruthy();
    // And it says where recordings are kept.
    expect(empty.textContent).toContain(RECORDINGS_DIR);
  });

  it("the header's Record button toggles recording, and reads Stop while one is running", async () => {
    addBundle(disk, NAME);
    await mountView();
    const record = screen.getByTestId("recordings-record");
    expect(record.textContent).toBe("Record");
    expect(record.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(record);
    expect(toggleRecordingMock).toHaveBeenCalledTimes(1);

    act(() => useRecordingStore.setState({ isRecording: true }));
    expect(record.textContent).toBe("Stop recording");
    expect(record.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(record);
    expect(toggleRecordingMock).toHaveBeenCalledTimes(2);
  });

  // U27: "75 min 03 s", no size, no source.
  it("a row says what the recording is: name, date, length as h:mm:ss, size, source, language, who recorded it", async () => {
    setLocale("en");
    addBundle(disk, NAME, {
      manifest: {
        title: "Weekly sync",
        language: "sv",
        createdBy: { device: "Peter's iPhone", app: "notesage-ios", appVersion: "0.60.0" },
      },
    });
    await mountView();
    const row = rowFor("Weekly sync");
    const text = row.textContent ?? "";
    expect(text).toContain("1:15:03");
    expect(text).not.toMatch(/75 min/);
    expect(text).toContain("34 MB");
    expect(text).toContain("Microphone");
    expect(text).toContain("Swedish");
    expect(text).toContain("from Peter's iPhone");
    expect(text).toMatch(/Sep 5, 2026/);
    expect(row.getAttribute("data-status")).toBe("not-transcribed");
    expect(within(row).getByTestId("recording-status").textContent).toBe("Not transcribed");
  });

  it("names the source of each kind of recording, with the original file for an import", async () => {
    addBundle(disk, "Recording 2026-09-01 09-00-00", { manifest: { title: "Sys", source: "system" } });
    addBundle(disk, "Recording 2026-09-02 09-00-00", { manifest: { title: "Both", source: "both" } });
    addBundle(disk, "Import Weekly 2026-11-25 101500", {
      manifest: { title: "Imported", source: "import", originalFile: { name: "Weekly sync.mp4", path: "/d/Weekly sync.mp4" } },
    });
    await mountView();
    expect(rowFor("Sys").textContent).toContain("System audio");
    expect(rowFor("Both").textContent).toContain("Microphone and system audio");
    expect(rowFor("Imported").textContent).toContain("Imported from Weekly sync.mp4");
  });

  it("shows the speakers of a recording that names them", async () => {
    addBundle(disk, NAME, {
      manifest: { title: "Weekly sync" },
      files: { "transcript.md": "# T\n", "speakers.json": JSON.stringify({ version: 1, names: { me: "Peter", "Anna Svensson": "Anna" } }) },
    });
    await mountView();
    expect(within(rowFor("Weekly sync")).getByTestId("recording-speakers").textContent).toBe("Speakers: Peter, Anna");
  });

  it("filters by name and by date", async () => {
    addBundle(disk, "Recording 2026-09-01 09-00-00", { manifest: { title: "Budget review", startedAt: "2026-09-01T09:00:00+02:00" } });
    addBundle(disk, "Recording 2026-10-14 13-00-00", { manifest: { title: "Weekly sync", startedAt: "2026-10-14T13:00:00+02:00" } });
    await mountView();
    const filter = screen.getByTestId("recordings-filter");

    fireEvent.change(filter, { target: { value: "weekly" } });
    expect(rows().map((r) => within(r).getByRole("heading").textContent)).toEqual(["Weekly sync"]);
    fireEvent.change(filter, { target: { value: "2026-09-01" } });
    expect(rows().map((r) => within(r).getByRole("heading").textContent)).toEqual(["Budget review"]);
    fireEvent.change(filter, { target: { value: "nothing like this" } });
    expect(rows()).toHaveLength(0);
    expect(screen.getByTestId("recordings-no-matches").textContent).toContain("nothing like this");
    fireEvent.change(filter, { target: { value: "" } });
    expect(rows()).toHaveLength(2);
  });

  it("matchesRecording looks at the title, the folder name, the original file and the date", () => {
    const b = {
      title: "Weekly sync",
      name: "Recording 2026-10-14 13-00-00",
      originalName: "Teams call.mp4",
      startedAt: "2026-10-14T13:00:00+02:00",
    } as RecordingBundle;
    expect(matchesRecording(b, "  WEEKLY ", "en")).toBe(true);
    expect(matchesRecording(b, "teams call", "en")).toBe(true);
    expect(matchesRecording(b, "Oct 14", "en")).toBe(true);
    expect(matchesRecording(b, "october", "en")).toBe(true);
    expect(matchesRecording(b, "13-00", "en")).toBe(true);
    expect(matchesRecording(b, "budget", "en")).toBe(false);
    expect(matchesRecording(b, "", "en")).toBe(true);
  });

  // U15: the list only loaded on mount.
  it("shows a recording that arrives while the view is open", async () => {
    addBundle(disk, NAME, { manifest: { title: "First" } });
    await mountView();
    expect(rows()).toHaveLength(1);

    addBundle(disk, "Recording 2026-09-06 09-00-00", { manifest: { title: "Second", startedAt: "2026-09-06T09:00:00+02:00" } });
    emitMockEvent("file-changed-batch", [{ path: `${RECORDINGS_DIR}/Recording 2026-09-06 09-00-00/recording.json`, kind: "create" }]);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(rows().map((r) => within(r).getByRole("heading").textContent)).toEqual(["Second", "First"]);
  });
});

// ===========================================================================
// U32 — accessible names
// ===========================================================================

describe("RecordingsView — accessibility (U32)", () => {
  it("every row action names its recording, so no two buttons in the list are called the same", async () => {
    addBundle(disk, "Recording 2026-09-01 09-00-00", { manifest: { title: "Budget review" }, files: { "transcript.md": "# T\n" } });
    addBundle(disk, "Recording 2026-09-02 09-00-00", { manifest: { title: "Weekly sync" }, files: { "transcript.md": "# T\n" } });
    await mountView();

    const names = screen
      .getAllByRole("button")
      .filter((b) => b.closest('[data-testid="recording-row"]'))
      .map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    expect(names).toEqual(
      expect.arrayContaining([
        "Open transcript: Budget review",
        "Open transcript: Weekly sync",
        "Transcribe again: Budget review",
        "Transcribe again: Weekly sync",
        "More actions: Budget review",
        "More actions: Weekly sync",
      ]),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("rows are list items that know their place in the whole list", async () => {
    for (let i = 1; i <= 3; i++) addBundle(disk, `Recording 2026-09-0${i} 09-00-00`);
    await mountView();
    expect(screen.getByRole("list", { name: "Recordings" })).toBeTruthy();
    expect(rows().map((r) => `${r.getAttribute("aria-posinset")}/${r.getAttribute("aria-setsize")}`)).toEqual(["1/3", "2/3", "3/3"]);
  });

  it("announces a change of status politely, once, without the ticking percent", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    await mountView();
    const live = screen.getByTestId("recordings-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("");

    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "tx-1", label: "Weekly sync", audioPath: `${dir}/audio.m4a` });
    });
    await waitFor(() => expect(live.textContent).toBe("Weekly sync: Transcribing…"));
    const announcements: string[] = [];
    const observer = new MutationObserver(() => announcements.push(live.textContent ?? ""));
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    act(() => {
      for (let p = 1; p <= 60; p++) useActivityStore.getState().setTranscriptionProgress("tx-1", p, "transcribing");
    });
    // Sixty percents later it has been said once and not again.
    expect(live.textContent).toBe("Weekly sync: Transcribing…");
    // The visible row does show the number.
    expect(within(rowFor("Weekly sync")).getByTestId("recording-status").textContent).toContain("Transcribing 60%");

    act(() => useActivityStore.getState().setTranscriptionError("tx-1", "Whisper state exploded"));
    await waitFor(() => expect(live.textContent).toBe("Weekly sync: Transcription failed: Whisper state exploded"));
    observer.disconnect();
    expect(announcements).toEqual(["Weekly sync: Transcription failed: Whisper state exploded"]);
  });

  it("spinners stop for people who asked for less motion", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    await mountView();
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "tx-1", label: "Weekly sync", audioPath: `${dir}/audio.m4a` });
    });
    await waitFor(() => expect(rowFor("Weekly sync").getAttribute("data-status")).toBe("running"));
    const spinners = [...rowFor("Weekly sync").querySelectorAll(".animate-spin")];
    expect(spinners.length).toBeGreaterThan(0);
    for (const spinner of spinners) expect(spinner.getAttribute("class")).toContain("motion-reduce:animate-none");
  });
});

// ===========================================================================
// U1 — leaving the view
// ===========================================================================

describe("RecordingsView — leaving (U1)", () => {
  it("Open transcript opens the transcript by its own name", async () => {
    const dir = addBundle(disk, NAME, {
      manifest: { title: "Weekly sync", transcript: { file: "Weekly sync.md" } },
      files: { "Weekly sync.md": "# Weekly sync\n" },
    });
    await mountView();
    fireEvent.click(screen.getByRole("button", { name: "Open transcript: Weekly sync" }));
    expect(openFileMock).toHaveBeenCalledWith(`${dir}/Weekly sync.md`, "Weekly sync.md");
  });

  it("Esc leaves the view", async () => {
    addBundle(disk, NAME);
    await mountView();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useRecordingsStore.getState().open).toBe(false);
  });

  it("Esc in the filter clears the filter first, and leaves on the second press", async () => {
    addBundle(disk, NAME);
    await mountView();
    const filter = screen.getByTestId("recordings-filter") as HTMLInputElement;
    fireEvent.change(filter, { target: { value: "x" } });
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(filter.value).toBe("");
    expect(useRecordingsStore.getState().open).toBe(true);
    fireEvent.keyDown(filter, { key: "Escape" });
    expect(useRecordingsStore.getState().open).toBe(false);
  });

  it("Esc belongs to an open dialog or menu, not to the view under it", async () => {
    addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    await pick("Rename");
    const dialog = await screen.findByTestId("rename-recording-dialog");
    fireEvent.keyDown(within(dialog).getByRole("textbox"), { key: "Escape" });
    expect(useRecordingsStore.getState().open).toBe(true);
  });

  it("Esc pressed somewhere else (the command bar) is not this view's", async () => {
    addBundle(disk, NAME);
    await mountView();
    const elsewhere = document.createElement("input");
    document.body.appendChild(elsewhere);
    fireEvent.keyDown(elsewhere, { key: "Escape" });
    elsewhere.remove();
    expect(useRecordingsStore.getState().open).toBe(true);
  });

  it("a key event something else already handled is left alone", async () => {
    addBundle(disk, NAME);
    await mountView();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    document.body.dispatchEvent(event);
    expect(useRecordingsStore.getState().open).toBe(true);
  });
});

// ===========================================================================
// Jobs from a row
// ===========================================================================

describe("RecordingsView — transcribing from a row", () => {
  interface Pending {
    args: Record<string, unknown>;
    resolve: (r: TranscriptionResult) => void;
    reject: (e: unknown) => void;
  }
  let pending: Pending[];
  const RESULT: TranscriptionResult = {
    segments: [{ start: 0, end: 3, text: "Hello there.", speaker_id: null, speaker_name: null }],
    duration_secs: 3,
    language: "en",
    decoder: "mock",
  };

  beforeEach(() => {
    pending = [];
    disk.transcribe = (args) =>
      new Promise<TranscriptionResult>((resolve, reject) => {
        pending.push({ args, resolve, reject });
      });
  });

  // U25: the row's retry reused language and model with no way to choose.
  it("Transcribe goes through the model and language menu", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync", language: "sv" } });
    renderHook(() => useTranscriptionJob());
    await mountView();

    openMenu(screen.getByRole("button", { name: "Transcribe: Weekly sync" }));
    // Only downloaded models are offered.
    expect(await screen.findByRole("menuitem", { name: /^Small/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^Medium/ })).toBeNull();
    await pick("Large V3");

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toMatchObject({ path: `${dir}/audio.m4a`, model: "large-v3", language: "sv" });
  });

  // U20: a double click issued two `transcribe_file` calls, and a success
  // toast before anything had run.
  it("asking twice starts one job, and claims no success before there is one", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    renderHook(() => useTranscriptionJob());
    await mountView();

    await act(async () => {
      await Promise.all([
        useRecordingsStore.getState().transcribe(dir, { model: "small" }),
        useRecordingsStore.getState().transcribe(dir, { model: "small" }),
      ]);
    });

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(disk.count("transcribe_file")).toBe(1);
    expect(useActivityStore.getState().tasks.filter((t) => t.kind === "transcription")).toHaveLength(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  // U16: no estimate, no cancel.
  it("a running job shows on its row with progress and Cancel, and without Transcribe", async () => {
    addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    renderHook(() => useTranscriptionJob());
    await mountView();
    openMenu(screen.getByRole("button", { name: "Transcribe: Weekly sync" }));
    await pick(/^Small/);
    await waitFor(() => expect(pending).toHaveLength(1));
    const jobId = String(pending[0].args.jobId);

    const row = rowFor("Weekly sync");
    await waitFor(() => expect(row.getAttribute("data-status")).toBe("running"));
    act(() => emitMockEvent("transcription-progress", { job_id: jobId, audio_path: pending[0].args.path, stage: "transcribing", percent: 42 }));
    expect(within(row).getByTestId("recording-status").textContent).toContain("Transcribing 42%");
    expect(within(row).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    expect(within(row).queryByRole("button", { name: /^Transcribe/ })).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Cancel transcription: Weekly sync" }));
    await waitFor(() =>
      expect(disk.calls.filter((c) => c.cmd === "cancel_transcription").map((c) => c.args)).toEqual([
        { jobId, audioPath: pending[0].args.path },
      ]),
    );

    // The backend lets go: the recording is "Not transcribed" again, not "Failed".
    await act(async () => {
      pending[0].reject(new Error("Transcription cancelled"));
    });
    await waitFor(() => expect(rowFor("Weekly sync").getAttribute("data-status")).toBe("not-transcribed"));
    expect(toastError).not.toHaveBeenCalled();
    expect(within(rowFor("Weekly sync")).getByRole("button", { name: "Transcribe: Weekly sync" })).toBeTruthy();
  });

  it("a second job waits its turn and says so", async () => {
    const first = addBundle(disk, "Recording 2026-09-01 09-00-00", { manifest: { title: "First", startedAt: "2026-09-01T09:00:00+02:00" } });
    const second = addBundle(disk, "Recording 2026-09-02 09-00-00", { manifest: { title: "Second", startedAt: "2026-09-02T09:00:00+02:00" } });
    await mountView();
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "a", label: "First", audioPath: `${first}/audio.m4a` });
      useActivityStore.setState((s) => ({ tasks: s.tasks.map((t) => ({ ...t, runStartedAt: 1000 })) }));
      useActivityStore.getState().addTranscriptionJob({ id: "b", label: "Second", audioPath: `${second}/audio.m4a` });
    });
    await waitFor(() => expect(rowFor("Second").getAttribute("data-status")).toBe("queued"));
    expect(within(rowFor("Second")).getByTestId("recording-status").textContent).toBe("Queued");
    expect(rowFor("First").getAttribute("data-status")).toBe("running");
    // A queued job can be cancelled too.
    expect(within(rowFor("Second")).getByRole("button", { name: "Cancel transcription: Second" })).toBeTruthy();
  });

  it("a progress stream re-reads nothing from disk", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    await mountView();
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "tx-1", label: "Weekly sync", audioPath: `${dir}/audio.m4a` });
    });
    await waitFor(() => expect(rowFor("Weekly sync").getAttribute("data-status")).toBe("running"));
    await waitFor(() => expect(useRecordingsStore.getState().loading).toBe(false));
    await new Promise((r) => setTimeout(r, 450)); // let the reload the job's start asked for happen
    await waitFor(() => expect(useRecordingsStore.getState().loading).toBe(false));
    disk.resetCalls();
    act(() => {
      for (let p = 1; p <= 100; p++) useActivityStore.getState().setTranscriptionProgress("tx-1", p, "transcribing");
    });
    await new Promise((r) => setTimeout(r, 450));
    expect(disk.calls).toEqual([]);
  });

  // U28
  it("a recording whose audio is still in iCloud says so and offers no Transcribe", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    disk.notLocal.add(`${dir}/audio.m4a`);
    await mountView();
    const row = rowFor("Weekly sync");
    expect(row.getAttribute("data-status")).toBe("downloading");
    expect(within(row).getByTestId("recording-status").textContent).toBe("Downloading from iCloud…");
    expect(within(row).queryByRole("button", { name: /^(Transcribe|Try again)/ })).toBeNull();
    expect(disk.count("icloud_ensure_downloaded")).toBe(1);
  });

  // U11
  it("a bundle with no manifest is 'Not transcribed', and Transcribe adopts it and starts a job", async () => {
    const dir = addBundle(disk, NAME, { manifest: null, audio: "audio.wav" });
    renderHook(() => useTranscriptionJob());
    await mountView();
    const row = rowFor(NAME);
    expect(within(row).getByTestId("recording-status").textContent).toBe("Not transcribed");

    openMenu(within(row).getByRole("button", { name: `Transcribe: ${NAME}` }));
    await pick(/^Small/);

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0].args).toMatchObject({ path: `${dir}/audio.wav`, model: "small" });
    expect(parseRecordingManifest(disk.files.get(`${dir}/recording.json`) ?? "")).not.toBeNull();
  });

  // U17 / U19
  it("a failed recording says why and offers the retry", async () => {
    addBundle(disk, "Recording 2026-09-01 09-00-00", {
      manifest: {
        title: "No model",
        transcription: { status: "failed", device: "This Mac", updatedAt: iso(0), error: "Model 'small' not downloaded. Download it from Settings > Transcription." },
      },
    });
    addBundle(disk, "Recording 2026-09-02 09-00-00", {
      manifest: { title: "Quit", transcription: { status: "running", device: "This Mac", updatedAt: iso(60_000) } },
    });
    await mountView();

    expect(within(rowFor("No model")).getByTestId("recording-status").textContent).toBe(
      "Transcription failed: The model “small” is not downloaded.",
    );
    expect(within(rowFor("No model")).getByRole("button", { name: "Try again: No model" })).toBeTruthy();
    // The manifest still said `running`; the row does not.
    expect(within(rowFor("Quit")).getByTestId("recording-status").textContent).toBe(
      "Transcription failed: Interrupted when Notesage quit",
    );
    expect(within(rowFor("Quit")).getByRole("button", { name: "Try again: Quit" })).toBeTruthy();
  });

  it("a recording another Mac is transcribing says where, and is left to it", async () => {
    addBundle(disk, NAME, {
      manifest: { title: "Weekly sync", transcription: { status: "running", device: "Peter's iMac", updatedAt: iso(60_000) } },
    });
    await mountView();
    const row = rowFor("Weekly sync");
    expect(within(row).getByTestId("recording-status").textContent).toBe("Transcribing on Peter's iMac…");
    expect(within(row).queryByRole("button", { name: /^Transcribe/ })).toBeNull();
    expect(within(row).queryByRole("button", { name: /^Cancel/ })).toBeNull();
  });

  // U23
  describe("Transcribe again never overwrites silently (U23)", () => {
    async function withTranscript(edit = false) {
      const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
      const written = await writeTranscript({ bundleDir: dir, segments: [{ start: 0, end: 2, text: "Original words." }] });
      if (edit) disk.files.set(written.path, disk.files.get(written.path)!.replace("Original words.", "Original words, corrected."));
      renderHook(() => useTranscriptionJob());
      await mountView();
      openMenu(screen.getByRole("button", { name: "Transcribe again: Weekly sync" }));
      await pick("Large V3");
      return { dir, path: written.path, dialog: await screen.findByTestId("replace-transcript-dialog") };
    }
    async function finish() {
      await waitFor(() => expect(pending).toHaveLength(1));
      await act(async () => {
        pending[0].resolve(RESULT);
      });
      await waitFor(() => expect(useActivityStore.getState().tasks[0]?.status).toBe("done"));
    }

    it("asks first, and Cancel starts nothing", async () => {
      const { dialog } = await withTranscript();
      expect(dialog.textContent).toContain("Weekly sync");
      expect(pending).toHaveLength(0);
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByTestId("replace-transcript-dialog")).toBeNull());
      expect(disk.count("transcribe_file")).toBe(0);
    });

    it("Keep both writes a second file and leaves the first untouched", async () => {
      const { dir, path, dialog } = await withTranscript();
      const before = disk.files.get(path);
      fireEvent.click(within(dialog).getByRole("button", { name: "Keep both" }));
      await finish();
      expect(disk.files.get(path)).toBe(before);
      expect(disk.files.get(`${dir}/Weekly sync (2).md`)).toContain("Hello there.");
    });

    it("Replace overwrites it", async () => {
      const { dir, path, dialog } = await withTranscript();
      fireEvent.click(within(dialog).getByRole("button", { name: "Replace" }));
      await finish();
      expect(disk.files.get(path)).toContain("Hello there.");
      expect(disk.files.has(`${dir}/Weekly sync (2).md`)).toBe(false);
    });

    it("does not claim an untouched transcript was edited", async () => {
      const untouched = await withTranscript(false);
      expect(within(untouched.dialog).queryByTestId("replace-transcript-edited")).toBeNull();
    });

    it("says so when the existing transcript was edited by hand", async () => {
      const edited = await withTranscript(true);
      expect(within(edited.dialog).getByTestId("replace-transcript-edited").textContent).toMatch(/edited since it was made/);
    });
  });
});

// ===========================================================================
// Rename, delete, move
// ===========================================================================

describe("RecordingsView — managing a recording (U21, U27, U29)", () => {
  it("Rename gives the recording a title; the folder keeps its name", async () => {
    const dir = addBundle(disk, NAME);
    await mountView();
    openMenu(screen.getByRole("button", { name: `More actions: ${NAME}` }));
    await pick("Rename");

    const dialog = await screen.findByTestId("rename-recording-dialog");
    const input = within(dialog).getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe(NAME);
    fireEvent.change(input, { target: { value: "Weekly sync" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() => expect(rowFor("Weekly sync")).toBeTruthy());
    expect(parseRecordingManifest(disk.files.get(`${dir}/recording.json`)!)?.title).toBe("Weekly sync");
    expect(disk.dirs.has(dir)).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("rename-recording-dialog")).toBeNull());
  });

  it("Delete asks first, naming the recording, and moves it to the Trash", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" }, files: { "transcript.md": "# T\n" } });
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    await pick("Delete…");

    const dialog = await screen.findByTestId("delete-recording-dialog");
    expect(dialog.textContent).toContain("Move “Weekly sync” to the Trash?");
    expect(dialog.textContent).toContain("its transcript");
    expect(disk.count("trash_path")).toBe(0);

    fireEvent.click(within(dialog).getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(disk.calls.filter((c) => c.cmd === "trash_path").map((c) => c.args)).toEqual([{ path: dir }]);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("“Weekly sync” was moved to the Trash"));
  });

  it("Cancel in the delete dialog deletes nothing", async () => {
    addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    await pick("Delete…");
    const dialog = await screen.findByTestId("delete-recording-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("delete-recording-dialog")).toBeNull());
    expect(disk.count("trash_path")).toBe(0);
    expect(rows()).toHaveLength(1);
  });

  it("while a recording is being transcribed it cannot be deleted or moved", async () => {
    useWorkspaceStore.setState({ projects: [{ path: "/Users/peter/Code/acme", fileTree: [] }] });
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    await mountView();
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "tx-1", label: "Weekly sync", audioPath: `${dir}/audio.m4a` });
    });
    await waitFor(() => expect(rowFor("Weekly sync").getAttribute("data-status")).toBe("running"));

    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    const del = await screen.findByRole("menuitem", { name: /^Delete/ });
    expect(del.getAttribute("aria-disabled")).toBe("true");
    expect(del.textContent).toContain("not while transcribing");
    expect(screen.queryByRole("menuitem", { name: "Move to project" })).toBeNull();
  });

  it("Move to project moves the folder and takes the row out of the list", async () => {
    useWorkspaceStore.setState({ projects: [{ path: "/Users/peter/Code/acme", fileTree: [] }] });
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" }, files: { "transcript.md": "# T\n" } });
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    const sub = await screen.findByRole("menuitem", { name: "Move to project" });
    act(() => {
      fireEvent.pointerMove(sub);
      fireEvent.click(sub);
      fireEvent.keyDown(sub, { key: "ArrowRight" });
    });
    await pick("acme");

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(disk.files.has(`/Users/peter/Code/acme/${NAME}/audio.m4a`)).toBe(true);
    expect(disk.files.has(`${dir}/audio.m4a`)).toBe(false);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Moved to acme"));
  });
});

// ===========================================================================
// N2 — import
// ===========================================================================

describe("RecordingsView — import (N2)", () => {
  it("Import recording… picks a file, imports it, lists it and transcribes it", async () => {
    renderHook(() => useTranscriptionJob());
    await mountView();
    disk.pick = "/Users/peter/Downloads/Weekly sync.mp4";

    fireEvent.click(screen.getAllByRole("button", { name: "Import recording…" })[0]);

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(disk.calls.find((c) => c.cmd === "open_file_dialog")?.args).toEqual({
      filterName: "Video and audio",
      filterExtensions: ["mp4", "mov", "m4a", "mp3", "wav", "flac"],
    });
    expect(disk.calls.filter((c) => c.cmd === "import_media").map((c) => c.args)).toEqual([
      { sourcePath: "/Users/peter/Downloads/Weekly sync.mp4", destRecordingsDir: RECORDINGS_DIR },
    ]);
    const row = rowFor("Weekly sync");
    expect(row.textContent).toContain("Imported from Weekly sync.mp4");
    expect(row.textContent).toContain("0:01:35");
    await waitFor(() => expect(disk.count("transcribe_file")).toBe(1));
  });

  it("cancelling the picker imports nothing", async () => {
    await mountView();
    disk.pick = null;
    fireEvent.click(screen.getAllByRole("button", { name: "Import recording…" })[0]);
    await waitFor(() => expect(disk.count("open_file_dialog")).toBe(1));
    expect(disk.count("import_media")).toBe(0);
  });

  it("shows the import while it runs, with progress and a Cancel", async () => {
    await mountView();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    setMockInvokeHandler("import_media", async () => {
      await gate;
      throw new Error("Import cancelled");
    });
    disk.pick = "/Users/peter/Downloads/Weekly sync.mp4";
    fireEvent.click(screen.getAllByRole("button", { name: "Import recording…" })[0]);

    const imports = await screen.findByTestId("recordings-imports");
    expect(imports.textContent).toContain("Importing Weekly sync.mp4…");
    act(() => emitMockEvent("import-progress", { source_path: "/Users/peter/Downloads/Weekly sync.mp4", percent: 37 }));
    expect(imports.textContent).toContain("37%");

    fireEvent.click(within(imports).getByRole("button", { name: "Cancel import: Weekly sync.mp4" }));
    await waitFor(() => expect(disk.count("cancel_transcription")).toBe(1));
    release();
    await waitFor(() => expect(screen.queryByTestId("recordings-imports")).toBeNull());
    // The user's own cancel is not reported as an error.
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows the backend's reason when a file cannot be imported", async () => {
    await mountView();
    setMockInvokeHandler("import_media", () => {
      throw new Error("No audio track found in Slides.mp4");
    });
    disk.pick = "/Users/peter/Downloads/Slides.mp4";
    fireEvent.click(screen.getAllByRole("button", { name: "Import recording…" })[0]);
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not import Slides.mp4: The file has no audio to transcribe."),
    );
    expect(rows()).toHaveLength(0);
  });

  describe("dropping a file on the view", () => {
    function drop(files: Array<{ name: string; path?: string }>) {
      const view = screen.getByTestId("recordings-view");
      const dataTransfer = {
        types: ["Files"],
        files: files.map((f) => Object.assign(new File(["x"], f.name), f.path ? { path: f.path } : {})),
        dropEffect: "none",
      };
      fireEvent.dragEnter(view, { dataTransfer });
      expect(screen.getByTestId("recordings-drop-target")).toBeTruthy();
      fireEvent.dragOver(view, { dataTransfer });
      fireEvent.drop(view, { dataTransfer });
      expect(screen.queryByTestId("recordings-drop-target")).toBeNull();
    }

    it("imports a dropped media file when the shell says where it lives", async () => {
      await mountView();
      drop([{ name: "Standup.m4a", path: "/Users/peter/Desktop/Standup.m4a" }]);
      await waitFor(() => expect(disk.count("import_media")).toBe(1));
      expect(disk.calls.find((c) => c.cmd === "import_media")?.args.sourcePath).toBe("/Users/peter/Desktop/Standup.m4a");
    });

    it("explains, and points to the picker, when a drop carries no path", async () => {
      await mountView();
      drop([{ name: "Standup.m4a" }]);
      expect(disk.count("import_media")).toBe(0);
      expect(toastError).toHaveBeenCalledTimes(1);
      const [message, options] = toastError.mock.calls[0] as [string, { action: { label: string } }];
      expect(message).toContain("Standup.m4a");
      expect(options.action.label).toBe("Import recording…");
    });

    it("refuses a file that is not video or audio", async () => {
      await mountView();
      drop([{ name: "notes.md", path: "/Users/peter/notes.md" }]);
      expect(disk.count("import_media")).toBe(0);
      expect(toastError).toHaveBeenCalledWith("notes.md is not a video or audio file Notesage can import.");
    });

    it("refuses WebM and Matroska by name, saying what to do instead", async () => {
      await mountView();
      drop([{ name: "Teams call.webm", path: "/Users/peter/Teams call.webm" }]);
      expect(disk.count("import_media")).toBe(0);
      expect(toastError).toHaveBeenCalledWith(
        "Teams call.webm is a WebM or Matroska file, which Notesage cannot import. Convert it to MP4 or M4A first.",
      );
    });

    it("ignores a drag that carries no files (a sidebar row)", async () => {
      await mountView();
      const view = screen.getByTestId("recordings-view");
      fireEvent.dragEnter(view, { dataTransfer: { types: ["application/x-notesage-row"], files: [] } });
      expect(screen.queryByTestId("recordings-drop-target")).toBeNull();
    });
  });
});

// ===========================================================================
// Speakers
// ===========================================================================

describe("RecordingsView — speakers", () => {
  const TWO = [
    { start: 1, end: 5, text: "Shall we start?", speaker: "me" },
    { start: 6, end: 9, text: "Yes, go ahead.", speaker: "others" },
  ];

  async function openSpeakers(edit = false) {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync", source: "both" } });
    const written = await writeTranscript({ bundleDir: dir, segments: TWO });
    if (edit) disk.files.set(written.path, disk.files.get(written.path)!.replace("Shall we start?", "Shall we start, then?"));
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    await pick("Speakers");
    const dialog = await screen.findByTestId("speakers-dialog");
    await within(dialog).findByLabelText("Name for Me");
    return { dir, path: written.path, dialog };
  }

  it("shows 'Me' and 'Others' for a two-track recording, in the app's language", async () => {
    setLocale("sv");
    const dir = addBundle(disk, NAME, { manifest: { title: "Veckomöte", source: "both" } });
    const written = await writeTranscript({ bundleDir: dir, segments: TWO });
    expect(disk.files.get(written.path)).toContain("**Jag** [00:00:01]");
    await mountView();
    expect(within(rowFor("Veckomöte")).getByTestId("recording-speakers").textContent).toBe("Talare: Jag, Övriga");
  });

  it("renaming a speaker rewrites an untouched transcript", async () => {
    const { dir, path, dialog } = await openSpeakers();
    fireEvent.change(within(dialog).getByLabelText("Name for Me"), { target: { value: "Peter" } });
    fireEvent.change(within(dialog).getByLabelText("Name for Others"), { target: { value: "Anna" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));

    await waitFor(() => expect(disk.files.get(path)).toContain("**Peter** [00:00:01] Shall we start?"));
    expect(disk.files.get(path)).toContain("**Anna** [00:00:06] Yes, go ahead.");
    expect(JSON.parse(disk.files.get(`${dir}/speakers.json`)!).names).toEqual({ me: "Peter", others: "Anna" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Speaker names updated in the transcript"));
    await waitFor(() => expect(within(rowFor("Weekly sync")).getByTestId("recording-speakers").textContent).toBe("Speakers: Peter, Anna"));
  });

  it("an edited transcript is not regenerated: it offers to update the names where turns begin, and explains", async () => {
    const { path, dialog } = await openSpeakers(true);
    const edited = disk.files.get(path)!;
    fireEvent.change(within(dialog).getByLabelText("Name for Me"), { target: { value: "Peter" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));

    const update = await within(dialog).findByRole("button", { name: "Update names in text" });
    expect(dialog.textContent).toMatch(/edited by hand/);
    // Nothing has touched the text yet.
    expect(disk.files.get(path)).toBe(edited);

    fireEvent.click(update);
    await waitFor(() => expect(disk.files.get(path)).toContain("**Peter** [00:00:01] Shall we start, then?"));
    // The hand edit is still there, and so is the other speaker.
    expect(disk.files.get(path)).toContain("**Others** [00:00:06] Yes, go ahead.");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Updated 1 place in the transcript"));
  });

  it("'Leave the text as it is' keeps the names and the text", async () => {
    const { dir, path, dialog } = await openSpeakers(true);
    const edited = disk.files.get(path)!;
    fireEvent.change(within(dialog).getByLabelText("Name for Me"), { target: { value: "Peter" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Leave the text as it is" }));
    await waitFor(() => expect(screen.queryByTestId("speakers-dialog")).toBeNull());
    expect(disk.files.get(path)).toBe(edited);
    expect(JSON.parse(disk.files.get(`${dir}/speakers.json`)!).names).toEqual({ me: "Peter" });
  });

  it("says so when a transcript does not tell speakers apart", async () => {
    const dir = addBundle(disk, NAME, { manifest: { title: "Solo" } });
    await writeTranscript({ bundleDir: dir, segments: [{ start: 0, end: 2, text: "Just me." }] });
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Solo" }));
    await pick("Speakers");
    expect((await screen.findByTestId("speakers-none")).textContent).toMatch(/does not tell speakers apart/);
  });
});

// ===========================================================================
// N3 — Teams transcript
// ===========================================================================

describe("RecordingsView — Teams transcript (N3)", () => {
  const SOURCE = "/Users/peter/Downloads/Weekly sync.vtt";

  async function openTeams(options: { transcribed?: boolean; vtt?: string } = {}) {
    const dir = addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    if (options.transcribed !== false) await writeTranscript({ bundleDir: dir, segments: OURS, language: "sv", model: "small" });
    disk.files.set(SOURCE, options.vtt ?? VTT);
    disk.pick = SOURCE;
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    await pick("Add Teams transcript…");
    return { dir, dialog: await screen.findByTestId("teams-dialog") };
  }

  it("shows who Teams heard, the estimated offset and how sure it is, and recommends keeping our text", async () => {
    const { dialog } = await openTeams();
    await within(dialog).findByTestId("teams-speakers");
    expect(disk.calls.find((c) => c.cmd === "open_file_dialog")?.args).toEqual({
      filterName: "Teams transcript",
      filterExtensions: ["vtt", "docx"],
    });
    expect(within(dialog).getByTestId("teams-speakers").textContent).toBe("Anna Svensson, Peter Lindberg, James Carter");
    expect(within(dialog).getByTestId("teams-offset").textContent).toContain("Starts 0:37 into the recording");
    expect(within(dialog).getByTestId("teams-confidence").textContent).toMatch(/^\d+% sure$/);
    expect(within(dialog).getByRole("radio", { name: /Use Notesage's text with Teams' speaker names \(recommended\)/ }).getAttribute("aria-checked")).toBe("true");
    // Confident: the offset controls stay folded away.
    expect(within(dialog).queryByTestId("teams-preview")).toBeNull();
  });

  it("adds the names to our transcript, asking before it replaces the one that is there", async () => {
    const { dir, dialog } = await openTeams();
    await within(dialog).findByTestId("teams-speakers");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to recording" }));

    const replace = await screen.findByTestId("replace-transcript-dialog");
    fireEvent.click(within(replace).getByRole("button", { name: "Replace" }));

    await waitFor(() => expect(disk.files.get(`${dir}/Weekly sync.md`)).toContain("**Anna Svensson** [00:01:00]"));
    expect(disk.files.get(`${dir}/teams-transcript.vtt`)).toBe(VTT);
    expect(disk.files.get(`${dir}/Weekly sync.md`)).toContain("ungefär 80 procent");
    await waitFor(() =>
      expect(within(rowFor("Weekly sync")).getByTestId("recording-speakers").textContent).toBe(
        "Speakers: Anna Svensson, Peter Lindberg, James Carter",
      ),
    );
    await waitFor(() => expect(screen.queryByTestId("teams-dialog")).toBeNull());
  });

  it("'Use Teams' text' writes Teams' words", async () => {
    const { dir, dialog } = await openTeams();
    await within(dialog).findByTestId("teams-speakers");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Use Teams' text" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to recording" }));
    fireEvent.click(within(await screen.findByTestId("replace-transcript-dialog")).getByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(disk.files.get(`${dir}/Weekly sync (2).md`)).toContain("åttio procent"));
    // The original is untouched.
    expect(disk.files.get(`${dir}/Weekly sync.md`)).toContain("80 procent");
  });

  it("low confidence: says so, and lets the offset be nudged with a live preview of aligned lines", async () => {
    // A Teams file about something else entirely: nothing to align on.
    const unrelated =
      "WEBVTT\n\n00:00:01.000 --> 00:00:06.000\n<v Kim>The quarterly budget review is postponed until further notice.</v>\n\n" +
      "00:01:10.000 --> 00:01:16.000\n<v Lee>Please remember to water the plants in the lobby.</v>\n";
    const { dialog } = await openTeams({ vtt: unrelated });
    await within(dialog).findByTestId("teams-speakers");

    expect(within(dialog).getByTestId("teams-confidence").textContent).toBe("Not sure");
    const preview = within(dialog).getByTestId("teams-preview");
    const before = preview.textContent;
    const input = within(dialog).getByLabelText("Offset in seconds") as HTMLInputElement;
    const start = Number(input.value);

    fireEvent.click(within(dialog).getByRole("button", { name: "One second later" }));
    expect(Number(input.value)).toBe(start + 1);
    fireEvent.change(input, { target: { value: "60" } });
    // The preview follows the offset: Kim's line now sits a minute in, beside what we heard then.
    expect(within(dialog).getByTestId("teams-preview").textContent).not.toBe(before);
    expect(within(dialog).getByTestId("teams-preview").textContent).toContain("00:01:01");
    expect(within(dialog).getByTestId("teams-offset").textContent).toContain("Starts 1:00 into the recording");

    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    expect(Number(input.value)).toBe(start);
    // Cancel leaves everything as it was.
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("teams-dialog")).toBeNull());
    expect(disk.count("copy_file")).toBe(0);
  });

  it("a recording with no transcript of ours can still take Teams' text", async () => {
    const { dir, dialog } = await openTeams({ transcribed: false });
    await within(dialog).findByTestId("teams-speakers");
    expect(dialog.textContent).toMatch(/no Notesage transcript yet/);
    expect(within(dialog).queryByRole("radio")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Add to recording" }));
    await waitFor(() => expect(disk.files.get(`${dir}/Weekly sync.md`)).toContain("**Peter Lindberg** [00:00:34] Tack Anna."));
    // Nothing to replace, so nothing to ask.
    expect(screen.queryByTestId("replace-transcript-dialog")).toBeNull();
    await waitFor(() => expect(rowFor("Weekly sync").getAttribute("data-status")).toBe("done"));
  });

  it("says so when the file holds no transcript", async () => {
    const { dialog } = await openTeams({ vtt: "WEBVTT\n\nNOTE nothing here\n" });
    expect((await within(dialog).findByTestId("teams-error")).textContent).toBe("No transcript lines were found in this file.");
    expect(within(dialog).queryByRole("button", { name: "Add to recording" })).toBeNull();
  });

  it("cancelling the picker opens nothing", async () => {
    addBundle(disk, NAME, { manifest: { title: "Weekly sync" } });
    disk.pick = null;
    await mountView();
    openMenu(screen.getByRole("button", { name: "More actions: Weekly sync" }));
    await pick("Add Teams transcript…");
    await waitFor(() => expect(disk.count("open_file_dialog")).toBe(1));
    expect(screen.queryByTestId("teams-dialog")).toBeNull();
  });
});

// ===========================================================================
// Swedish
// ===========================================================================

describe("RecordingsView — in Swedish (U33)", () => {
  it("has no English left in the header, a row, or its menu", async () => {
    setLocale("sv");
    addBundle(disk, NAME, { manifest: { title: "Veckomöte", language: "sv" }, files: { "transcript.md": "# T\n" } });
    await mountView();

    expect(screen.getByTestId("recordings-record").textContent).toBe("Spela in");
    expect(screen.getByTestId("recordings-import").textContent).toBe("Importera inspelning…");
    const row = rowFor("Veckomöte");
    expect(row.textContent).toContain("Mikrofon");
    expect(row.textContent).toContain("Svenska");
    expect(within(row).getByTestId("recording-status").textContent).toBe("Transkriberad");
    expect(within(row).getByRole("button", { name: "Öppna transkriptionen: Veckomöte" })).toBeTruthy();

    openMenu(within(row).getByRole("button", { name: "Fler åtgärder: Veckomöte" }));
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    expect(items).toEqual(["Byt namn", "Talare", "Identifiera talare…", "Lägg till Teams-transkription…", "Visa i Finder", "Radera…"]);
  });
});

// ===========================================================================
// Windowing
// ===========================================================================

describe("RecordingsView — a long list is windowed", () => {
  function seed(count: number) {
    for (let i = 0; i < count; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      const month = String(Math.floor(i / 28) + 1).padStart(2, "0");
      addBundle(disk, `Recording 2026-${month}-${day} 09-00-00`, {
        manifest: { startedAt: `2026-${month}-${day}T09:00:00+02:00`, transcript: { file: "t.md" } },
        files: { "t.md": "# T\n" },
      });
    }
  }

  it("mounts only the rows near the viewport, and tells assistive tech the full count", async () => {
    layout = stubInboxLayout({ viewport: 800, row: 126 });
    seed(300);
    await mountView();

    const list = screen.getByTestId("recordings-list");
    expect(list.getAttribute("data-windowed")).toBe("true");
    expect(useRecordingsStore.getState().bundles).toHaveLength(300);
    expect(rows().length).toBeGreaterThan(4);
    expect(rows().length).toBeLessThan(30);
    expect(rows()[0].getAttribute("aria-setsize")).toBe("300");
    expect(rows()[0].getAttribute("aria-posinset")).toBe("1");
    // The scroll height is that of all 300.
    expect(parseInt(list.style.height, 10)).toBeGreaterThan(300 * 100);
  });

  it("a short list is not windowed", async () => {
    layout = stubInboxLayout({ viewport: 800, row: 126 });
    seed(WINDOW_THRESHOLD);
    await mountView();
    expect(screen.getByTestId("recordings-list").getAttribute("data-windowed")).toBeNull();
    expect(rows()).toHaveLength(WINDOW_THRESHOLD);
  });

  it("without a layout (no viewport height) every row is rendered rather than none", async () => {
    seed(WINDOW_THRESHOLD + 5);
    await mountView();
    expect(rows()).toHaveLength(WINDOW_THRESHOLD + 5);
  });
});
