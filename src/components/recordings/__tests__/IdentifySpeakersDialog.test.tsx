// @vitest-environment jsdom

/**
 * "Identify speakers…" end to end: the Recordings view on an in-memory
 * Recordings folder, the real stores, the real file helpers, and the
 * in-memory voice backend, which refuses consent-gated calls without consent
 * and logs everything it is sent.
 *
 * Two things are checked over and over because they are the point:
 *  - a suggestion never becomes a name unless the user clicks it;
 *  - a voiceprint reaches `voice_profile_save` / `voice_profiles_match` and
 *    nothing else: no file, no persisted state, no DOM.
 */

import "@/test/local-storage";
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderHook } from "@testing-library/react";
import { toast } from "sonner";
import { act, fireEvent, renderWithProviders, screen, waitFor, within } from "@/test/component-harness";
import {
  emitMockEvent,
  mockEmbedding,
  registerSpeakerHandlers,
  setMockInvokeHandler,
  type SpeakerMockState,
} from "@/test/tauri-mock";
import { RECORDINGS_DIR, addBundle, installFakeDisk, type FakeDisk } from "@/test/fake-recordings-disk";
import { RecordingsView } from "@/components/recordings/RecordingsView";
import { useTranscriptionJob } from "@/hooks/useTranscriptionJob";
import { setLocale } from "@/lib/i18n";
import { clearAllPreparedAnalyses, getPreparedAnalysis, preparedAnalysisDirs } from "@/lib/speakers/analysis-cache";
import { parseSegmentsFile, type Segment } from "@/lib/transcription/segments";
import { writeSpeakers, writeTranscript } from "@/lib/transcription/transcript-files";
import { useActivityStore } from "@/stores/activity-store";
import { useRecordingStore } from "@/stores/recording-store";
import { __resetRecordingsStoreMemory, useRecordingsStore } from "@/stores/recordings-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useSpeakersStore } from "@/stores/speakers-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const { openFileMock } = vi.hoisted(() => ({
  openFileMock: vi.fn<(path: string, name: string) => Promise<void>>(async () => undefined),
}));
vi.mock("@/hooks/useFileOperations", () => ({
  useFileOperations: () => ({ openFile: openFileMock }),
}));
vi.mock("@/hooks/useMeetingRecording", () => ({
  toggleMeetingRecording: async () => undefined,
}));

const toastSuccess = toast.success as ReturnType<typeof vi.fn>;
const toastError = toast.error as ReturnType<typeof vi.fn>;
const toastInfo = toast.info as ReturnType<typeof vi.fn>;

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
// jsdom has no media playback.
const playMock = vi.fn(async () => undefined);
const pauseMock = vi.fn();
Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, writable: true, value: playMock });
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, writable: true, value: pauseMock });

const FIXTURES = join(__dirname, "../../../lib/transcription/__tests__/fixtures");
const TEAMS_VTT = readFileSync(join(FIXTURES, "teams-meeting.vtt"), "utf8");
const TEAMS_OURS = parseSegmentsFile(readFileSync(join(FIXTURES, "teams-meeting.segments.json"), "utf8"))!;

const NAME = "Recording 2026-11-20 09-00-00";
const TITLE = "Weekly sync";
const DIR = `${RECORDINGS_DIR}/${NAME}`;

/** A single-track meeting: nobody is labelled yet. */
const PLAIN: Segment[] = [
  { start: 0, end: 5, text: "Okay, shall we start? This is Anna from marketing." },
  { start: 6, end: 11, text: "Hej, jag heter Erik Lund." },
  { start: 12, end: 18, text: "Great. First point is the budget." },
  { start: 19, end: 24, text: "I think we should wait for the numbers." },
];
/** A microphone + system-audio meeting. */
const TWO_TRACK: Segment[] = [
  { start: 0, end: 5, text: "Welcome everyone.", speaker: "me" },
  { start: 6, end: 11, text: "Thanks. My name is Anna Berg.", speaker: "others" },
  { start: 12, end: 18, text: "And Erik here, hello.", speaker: "others" },
  { start: 19, end: 24, text: "Good, let us begin.", speaker: "me" },
];

let disk: FakeDisk;
let backend: SpeakerMockState;

function files(prefix = DIR): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, content] of disk.files) if (path.startsWith(`${prefix}/`)) out[path.slice(prefix.length + 1)] = content;
  return out;
}
function json(file: string): Record<string, unknown> {
  return JSON.parse(disk.files.get(`${DIR}/${file}`) ?? "null") as Record<string, unknown>;
}
function transcriptFile(): string {
  const manifest = json("recording.json") as { transcript?: { file: string } };
  return manifest.transcript?.file ?? "transcript.md";
}
function transcript(): string {
  return disk.files.get(`${DIR}/${transcriptFile()}`) ?? "";
}

/** A serialised embedding: what must never be found anywhere it could persist. */
function looksLikeEmbedding(text: string): boolean {
  // 256 floats in a row. Nothing else the app writes has twenty numbers in a JSON array.
  return /\[\s*(-?\d+\.\d+(e-?\d+)?\s*,\s*){19,}/i.test(text) || text.includes("embedding");
}
function assertNoEmbeddingOnDisk() {
  for (const [path, content] of disk.files) {
    expect(looksLikeEmbedding(content), `embedding found in ${path}`).toBe(false);
  }
  const first = String(mockEmbedding(1)[0]);
  for (const [path, content] of disk.files) expect(content.includes(first), path).toBe(false);
  for (const call of disk.calls) {
    if (call.cmd === "write_file") expect(looksLikeEmbedding(String(call.args.content)), String(call.args.path)).toBe(false);
  }
}
function assertNoEmbeddingPersistedOrRendered() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) ?? "";
    expect(looksLikeEmbedding(localStorage.getItem(key) ?? ""), `embedding in localStorage ${key}`).toBe(false);
  }
  const saved = JSON.parse(localStorage.getItem("notesage-speakers") ?? '{"state":{}}') as { state: Record<string, unknown> };
  expect(Object.keys(saved.state).sort()).toEqual(["autoIdentify", "learnFromTeams", "rememberVoices"]);
  // The store itself never holds one either, persisted or not.
  expect(looksLikeEmbedding(JSON.stringify(useSpeakersStore.getState()))).toBe(false);
  expect(looksLikeEmbedding(document.body.innerHTML)).toBe(false);
}

async function seed(segments: Segment[], options: { manifest?: Record<string, unknown>; edit?: boolean } = {}) {
  addBundle(disk, NAME, { manifest: { title: TITLE, ...(options.manifest ?? {}) } });
  const written = await writeTranscript({ bundleDir: DIR, segments });
  if (options.edit) {
    disk.files.set(written.path, `${disk.files.get(written.path)}\nA note I typed myself.\n`);
  }
  return written.path;
}
function seedTwoTrack(options: { edit?: boolean } = {}) {
  disk.files.set(`${DIR}/mic.m4a`, "<audio>");
  disk.files.set(`${DIR}/system.m4a`, "<audio>");
  return seed(TWO_TRACK, {
    ...options,
    manifest: {
      source: "both",
      tracks: [
        { role: "mic", file: "mic.m4a" },
        { role: "system", file: "system.m4a" },
      ],
    },
  });
}

async function mountView() {
  const view = renderWithProviders(<RecordingsView />);
  await waitFor(() => expect(useRecordingsStore.getState().loading).toBe(false));
  await waitFor(() => expect(screen.queryAllByTestId("recording-row").length).toBeGreaterThan(0));
  return view;
}
function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(trigger, { button: 0 });
    fireEvent.click(trigger);
  });
}
async function openIdentify(title = TITLE): Promise<HTMLElement> {
  openMenu(screen.getByRole("button", { name: `More actions: ${title}` }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Identify speakers…" }));
  const dialog = await screen.findByTestId("identify-speakers-dialog");
  await waitFor(() => expect(dialog.getAttribute("data-view")).not.toBe("loading"));
  return dialog;
}
/** Open the dialog and run the analysis to its result screen. */
async function identify(title = TITLE): Promise<HTMLElement> {
  const dialog = await openIdentify(title);
  fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
  await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));
  return dialog;
}
function voiceRows(dialog: HTMLElement): HTMLElement[] {
  return within(dialog).getAllByTestId("speaker-row");
}
function nameField(dialog: HTMLElement, speaker: string): HTMLInputElement {
  return within(dialog).getByLabelText(`Name for ${speaker}`) as HTMLInputElement;
}
function chips(row: HTMLElement): string[] {
  return within(row)
    .queryAllByTestId("speaker-suggestion")
    .map((chip) => chip.textContent ?? "");
}
/** Hold `analyze_speakers` open; returns the handles to finish it. */
function holdAnalysis() {
  const original = backend.analyze;
  const handle: { resolve: () => void; reject: (reason: string) => void; args: Record<string, unknown> | null } = {
    resolve: () => undefined,
    reject: () => undefined,
    args: null,
  };
  backend.analyze = (args) =>
    new Promise((resolve, reject) => {
      handle.args = args;
      handle.resolve = () => resolve(original(args));
      handle.reject = (reason) => reject(new Error(reason));
    });
  return handle;
}
function consentedCalls(): string[] {
  return backend.calls.filter((call) => call.args.consent === true).map((call) => call.cmd);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearAllPreparedAnalyses();
  __resetRecordingsStoreMemory();
  setLocale("en");
  disk = installFakeDisk();
  backend = registerSpeakerHandlers();
  useSpeakersStore.setState(useSpeakersStore.getInitialState(), true);
  useRecordingsStore.setState({ open: true, dir: null, bundles: [], error: null, loading: false, imports: [], rootOverride: null });
  useActivityStore.setState({ tasks: [] });
  useWorkspaceStore.setState({ projects: [] });
  useRecordingStore.setState({
    isRecording: false,
    defaultModel: "small",
    speechLanguage: "en",
    availableModels: [{ name: "small", size_bytes: 1, downloaded: true }],
  } as Partial<ReturnType<typeof useRecordingStore.getState>>);
  useSettingsStore.setState({ notesRootPath: "~/Notesage", homeDir: "/Users/peter", icloudNotesagePath: null });
});

afterEach(() => {
  setLocale(null);
});

// ===========================================================================
// Where the action is
// ===========================================================================

describe("Identify speakers — the row action", () => {
  it("is offered for a recording with a transcript", async () => {
    await seed(PLAIN);
    await mountView();
    openMenu(screen.getByRole("button", { name: `More actions: ${TITLE}` }));
    expect(await screen.findByRole("menuitem", { name: "Identify speakers…" })).toBeTruthy();
    // Renaming is still there, beside it.
    expect(screen.getByRole("menuitem", { name: "Speakers" })).toBeTruthy();
  });

  it("is not offered before there is a transcript", async () => {
    addBundle(disk, NAME, { manifest: { title: TITLE, autoTranscribe: false } });
    await mountView();
    openMenu(screen.getByRole("button", { name: `More actions: ${TITLE}` }));
    await screen.findByRole("menuitem", { name: "Rename" });
    expect(screen.queryByRole("menuitem", { name: "Identify speakers…" })).toBeNull();
  });

  it("is not offered when a Teams transcript already names the speakers", async () => {
    await seed(PLAIN);
    disk.files.set(`${DIR}/teams-transcript.vtt`, TEAMS_VTT);
    await mountView();
    openMenu(screen.getByRole("button", { name: `More actions: ${TITLE}` }));
    await screen.findByRole("menuitem", { name: "Replace Teams transcript…" });
    expect(screen.queryByRole("menuitem", { name: "Identify speakers…" })).toBeNull();
  });

  it("offers to download the voice model when it is missing, and takes the user to the Speakers settings", async () => {
    backend.modelInstalled = false;
    await seed(PLAIN);
    await mountView();
    const dialog = await openIdentify();
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("model"));
    expect(within(dialog).getByTestId("identify-model-missing").textContent).toContain("voice model");
    expect(within(dialog).queryByRole("button", { name: "Find voices" })).toBeNull();

    const opened = vi.fn();
    window.addEventListener("notesage:open-settings", opened);
    fireEvent.click(within(dialog).getByRole("button", { name: "Download in Settings…" }));
    window.removeEventListener("notesage:open-settings", opened);
    expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: "voice" });
    expect(useSpeakersStore.getState().focusSettingsSection).toBe(true);
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(backend.argsOf("analyze_speakers")).toHaveLength(0);
  });

  it("says so when the transcript has no timings to attach speakers to", async () => {
    addBundle(disk, NAME, { manifest: { title: TITLE }, files: { "transcript.md": "# Weekly sync\n\nJust text.\n" } });
    await mountView();
    const dialog = await openIdentify();
    expect(dialog.getAttribute("data-view")).toBe("no-segments");
    expect(within(dialog).getByTestId("identify-no-segments")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Find voices" })).toBeNull();
  });
});

// ===========================================================================
// Running the analysis
// ===========================================================================

describe("Identify speakers — the analysis job", () => {
  it("sends the transcript's segments with a job id, the optional hint, and no tracks for a plain recording", async () => {
    await seed(PLAIN);
    await mountView();
    const dialog = await openIdentify();
    fireEvent.change(within(dialog).getByLabelText("Who was in the meeting? (optional)"), {
      target: { value: "Anna Berg, Erik Lund\nSara Ek" },
    });
    fireEvent.change(within(dialog).getByLabelText("Number of speakers (optional)"), { target: { value: "3" } });
    const before = transcript();
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(backend.argsOf("analyze_speakers")).toHaveLength(1));

    const sent = backend.argsOf("analyze_speakers")[0];
    expect(typeof sent.jobId).toBe("string");
    expect(String(sent.jobId).length).toBeGreaterThan(4);
    expect(sent).toMatchObject({
      audioPath: `${DIR}/audio.m4a`,
      tracks: null,
      expectedSpeakers: 3,
      sharedMicrophone: null,
    });
    expect(sent.segments).toEqual(PLAIN);

    // The participants are remembered for the recording; the transcript and
    // its segments are untouched by merely running the analysis.
    await waitFor(() => expect(json("speakers.json").participants).toEqual(["Anna Berg", "Erik Lund", "Sara Ek"]));
    expect(transcript()).toBe(before);
    expect(parseSegmentsFile(disk.files.get(`${DIR}/segments.json`)!)).toEqual(PLAIN);
  });

  it("an empty or silly hint is sent as “find out”, and a large one is capped at what the backend accepts", async () => {
    await seed(PLAIN);
    await mountView();
    let dialog = await identify();
    expect(backend.argsOf("analyze_speakers")[0].expectedSpeakers).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Analyse again…" }));
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("setup"));
    fireEvent.change(within(dialog).getByLabelText("Number of speakers (optional)"), { target: { value: "99" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(backend.argsOf("analyze_speakers")).toHaveLength(2));
    expect(backend.argsOf("analyze_speakers")[1].expectedSpeakers).toBe(30);
    dialog = screen.getByTestId("identify-speakers-dialog");
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));
  });

  it("shows progress from its own job's events only, in the dialog and on the row, and announces state not percent", async () => {
    await seed(PLAIN);
    await mountView();
    const held = holdAnalysis();
    const dialog = await openIdentify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(held.args).not.toBeNull());
    const jobId = String(held.args?.jobId);

    const progress = within(dialog).getByTestId("identify-progress");
    expect(progress.getAttribute("data-phase")).toBe("starting");
    expect(progress.textContent).toContain("Starting…");

    // Somebody else's job: ignored.
    act(() => {
      emitMockEvent("speaker-analysis-progress", { job_id: "other", audio_path: `${DIR}/audio.m4a`, stage: "analyzing", percent: 90 });
    });
    expect(within(dialog).getByTestId("identify-progress").getAttribute("data-phase")).toBe("starting");

    act(() => {
      emitMockEvent("speaker-analysis-progress", { job_id: jobId, audio_path: `${DIR}/audio.m4a`, stage: "loading", percent: 0 });
    });
    await waitFor(() => expect(within(dialog).getByTestId("identify-progress").textContent).toContain("Loading the voice model…"));

    act(() => {
      emitMockEvent("speaker-analysis-progress", { job_id: jobId, audio_path: `${DIR}/audio.m4a`, stage: "analyzing", percent: 42 });
    });
    await waitFor(() => expect(within(dialog).getByTestId("identify-progress").textContent).toContain("Listening for voices 42%"));
    const bar = within(dialog).getByRole("progressbar", { name: `Speaker identification progress: ${TITLE}` });
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByTestId("recording-speaker-job").textContent).toBe("Identifying speakers 42%");
    // The live region says what is happening, not the number.
    expect(within(dialog).getByTestId("identify-live").textContent).toBe("Identifying speakers");
    expect(within(dialog).getByTestId("identify-live").getAttribute("aria-live")).toBe("polite");

    await act(async () => {
      held.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));
    expect(within(dialog).getByTestId("identify-live").textContent).toBe("2 voices found.");
    expect(screen.queryByTestId("recording-speaker-job")).toBeNull();
    expect(useSpeakersStore.getState().jobs).toEqual({});
  });

  it("says “Waiting for transcription to finish” while a transcription is ahead of it in the queue", async () => {
    await seed(PLAIN);
    await mountView();
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "t1", label: "Another meeting", audioPath: "/elsewhere/audio.m4a" });
    });
    const held = holdAnalysis();
    const dialog = await openIdentify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(held.args).not.toBeNull());

    const progress = within(dialog).getByTestId("identify-progress");
    expect(progress.getAttribute("data-phase")).toBe("waiting");
    expect(progress.textContent).toContain("Waiting for transcription to finish");
    expect(within(dialog).getByTestId("identify-live").textContent).toBe("Waiting for transcription to finish");
    expect(screen.getByTestId("recording-speaker-job").textContent).toBe(
      "Identify speakers: waiting for transcription to finish",
    );

    // Its turn came: the backend's first event ends the wait.
    act(() => {
      emitMockEvent("speaker-analysis-progress", { job_id: held.args?.jobId, audio_path: "x", stage: "analyzing", percent: 5 });
    });
    await waitFor(() => expect(within(dialog).getByTestId("identify-progress").getAttribute("data-phase")).toBe("running"));
    await act(async () => {
      held.resolve();
      await Promise.resolve();
    });
  });

  it("can be cancelled, by job id and never by path, and a cancel is not shown as an error", async () => {
    await seed(PLAIN);
    await mountView();
    const held = holdAnalysis();
    const cancelled: Array<Record<string, unknown>> = [];
    setMockInvokeHandler("cancel_transcription", (args) => {
      cancelled.push(args ?? {});
      held.reject("Speaker analysis cancelled");
      return true;
    });
    const dialog = await openIdentify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(held.args).not.toBeNull());

    fireEvent.click(within(dialog).getByRole("button", { name: "Stop analysis" }));
    await waitFor(() => expect(cancelled).toHaveLength(1));
    expect(cancelled[0]).toEqual({ jobId: held.args?.jobId, audioPath: null });

    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("setup"));
    expect(within(dialog).queryByTestId("identify-error")).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    expect(useSpeakersStore.getState().prepared).toEqual({});
    expect(preparedAnalysisDirs()).toEqual([]);
  });

  it("keeps running when the dialog is closed, and reopening shows where it is", async () => {
    await seed(PLAIN);
    await mountView();
    const held = holdAnalysis();
    let dialog = await openIdentify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(held.args).not.toBeNull());
    fireEvent.click(within(dialog).getByTestId("identify-close"));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(screen.getByTestId("recording-speaker-job")).toBeTruthy();

    await act(async () => {
      held.resolve();
      await Promise.resolve();
    });
    // Finished in the background: the row says there is something to look at…
    const link = await within(await screen.findByTestId("recording-speaker-suggestions")).findByRole("button");
    expect(link.textContent).toBe("Speaker names suggested");
    expect(link.getAttribute("aria-label")).toBe(`Speaker names suggested: ${TITLE}`);
    // …and nothing in the bundle has changed.
    expect(parseSegmentsFile(disk.files.get(`${DIR}/segments.json`)!)).toEqual(PLAIN);
    expect(disk.files.has(`${DIR}/speakers.json`)).toBe(false);

    fireEvent.click(link);
    dialog = await screen.findByTestId("identify-speakers-dialog");
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));
    expect(backend.argsOf("analyze_speakers")).toHaveLength(1);
  });

  it("an analysis made for a transcript that has since been replaced is dropped, not offered for saving", async () => {
    await seed(PLAIN);
    await mountView();
    let dialog = await identify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(useSpeakersStore.getState().prepared[DIR]).toBeDefined();

    // Transcribed again elsewhere: other words arrive in segments.json.
    const retranscribed = PLAIN.map((s, i) => (i === 2 ? { ...s, text: "Good. The first point is the budget." } : s));
    disk.files.set(`${DIR}/segments.json`, `${JSON.stringify({ version: 1, segments: retranscribed })}\n`);

    dialog = await openIdentify();
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("setup"));
    expect(useSpeakersStore.getState().prepared[DIR]).toBeUndefined();
    expect(getPreparedAnalysis(DIR)).toBeUndefined();
    expect(screen.queryByTestId("recording-speaker-suggestions")).toBeNull();
  });

  it("transcribing a recording again drops the analysis held for its old transcript", async () => {
    await seed(PLAIN);
    await mountView();
    const dialog = await identify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(useSpeakersStore.getState().prepared[DIR]).toBeDefined();
    act(() => {
      useActivityStore.getState().addTranscriptionJob({ id: "again", label: TITLE, audioPath: `${DIR}/audio.m4a` });
    });
    expect(useSpeakersStore.getState().prepared[DIR]).toBeUndefined();
    expect(getPreparedAnalysis(DIR)).toBeUndefined();
  });

  it("shows why an analysis failed, in the app's words where it knows them, and lets the user try again", async () => {
    await seed(PLAIN);
    await mountView();
    backend.analyze = () => {
      throw new Error("Audio file not found: /x/audio.m4a");
    };
    const dialog = await openIdentify();
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    const alert = await within(dialog).findByTestId("identify-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe("The audio file is missing.");
    expect(dialog.getAttribute("data-view")).toBe("setup");
    expect(within(dialog).getByRole("button", { name: "Find voices" })).toBeTruthy();
  });

  it("says so when no voices were found, and offers nothing to save", async () => {
    await seed(PLAIN);
    await mountView();
    backend.analyze = (args) => ({ turns: [], speakers: [], segments: args.segments, duration_secs: 24, model: "m" });
    const dialog = await identify();
    expect(within(dialog).getByTestId("identify-none").textContent).toBe("No voices were found in this recording.");
    expect(within(dialog).queryByRole("button", { name: "Save names" })).toBeNull();
  });
});

// ===========================================================================
// The result screen
// ===========================================================================

describe("Identify speakers — the voices found", () => {
  it("lists each voice as “Speaker N” with its speaking time and an empty name field", async () => {
    await seed(PLAIN);
    await mountView();
    const dialog = await identify();
    const rows = voiceRows(dialog);
    expect(rows).toHaveLength(2);
    expect(within(dialog).getByTestId("identify-count").textContent).toBe("2 voices found.");
    expect(rows[0].textContent).toContain("Speaker 1");
    expect(rows[0].textContent).toContain("Spoke for 0:02:00");
    expect(rows[1].textContent).toContain("Speaker 2");
    expect(rows[1].textContent).toContain("Spoke for 0:01:00");
    expect(nameField(dialog, "Speaker 1").value).toBe("");
    expect(nameField(dialog, "Speaker 2").value).toBe("");
    // Voices are not remembered: there is no checkbox at all.
    expect(within(dialog).queryByRole("checkbox")).toBeNull();
    expect(within(dialog).getByTestId("identify-privacy").textContent).toBe(
      "Voices are not remembered: these names apply to this recording only.",
    );
  });

  it("plays a voice's sample: a real button with a pressed state, named after the voice, fetching exactly its clip", async () => {
    await seed(PLAIN);
    await mountView();
    const dialog = await identify();
    const play1 = within(dialog).getByRole("button", { name: "Play sample of Speaker 1" });
    const play2 = within(dialog).getByRole("button", { name: "Play sample of Speaker 2" });
    expect(play1.tagName).toBe("BUTTON");
    expect(play1.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(play2);
    await waitFor(() => expect(backend.argsOf("extract_audio_clip")).toHaveLength(1));
    // Speaker 2's sample in the mock is 11 s to 17 s of the recording's audio.
    expect(backend.argsOf("extract_audio_clip")[0]).toEqual({ audioPath: `${DIR}/audio.m4a`, start: 11, end: 17 });
    const stop2 = await within(dialog).findByRole("button", { name: "Stop sample of Speaker 2" });
    expect(stop2.getAttribute("aria-pressed")).toBe("true");
    expect(playMock).toHaveBeenCalledTimes(1);
    const audio = within(dialog).getByTestId("speaker-audio") as HTMLAudioElement;
    // Loaded through the asset protocol, from the clip the backend made.
    expect(audio.getAttribute("src")).toBe(
      `asset://localhost/${encodeURIComponent("/tmp/notesage-speaker-clips/clip-110-170.wav")}`,
    );
    // Only one sample plays at a time.
    expect(within(dialog).getByRole("button", { name: "Play sample of Speaker 1" }).getAttribute("aria-pressed")).toBe("false");

    // The clip ends: the button is a play button again.
    act(() => {
      fireEvent.ended(audio);
    });
    await within(dialog).findByRole("button", { name: "Play sample of Speaker 2" });

    // Playing it again does not extract it again; stopping pauses.
    fireEvent.click(within(dialog).getByRole("button", { name: "Play sample of Speaker 2" }));
    const stop = await within(dialog).findByRole("button", { name: "Stop sample of Speaker 2" });
    expect(backend.argsOf("extract_audio_clip")).toHaveLength(1);
    fireEvent.click(stop);
    await within(dialog).findByRole("button", { name: "Play sample of Speaker 2" });
    expect(pauseMock).toHaveBeenCalled();
  });

  it("a sample that cannot be made says why and leaves the button a play button", async () => {
    await seed(PLAIN);
    await mountView();
    const dialog = await identify();
    setMockInvokeHandler("extract_audio_clip", () => {
      throw new Error("The recording has no audio in that range");
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Play sample of Speaker 1" }));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not play the sample: The recording has no audio at that point."),
    );
    expect(within(dialog).getByRole("button", { name: "Play sample of Speaker 1" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("offers names from the participant list and from introductions in the transcript, marked as such, and applies none of them", async () => {
    await seed(PLAIN);
    await writeSpeakers(DIR, {}, { participants: ["Anna Berg", "Sara Ek"] });
    await mountView();
    const dialog = await identify();
    const [first, second] = voiceRows(dialog);
    // Speaker 1 said "This is Anna from marketing" (segment 0): "Anna" is "Anna Berg" on the list.
    expect(chips(first)).toEqual(["Anna Berg· from the transcript", "Sara Ek"]);
    // Speaker 2 said "jag heter Erik Lund" (segment 1).
    expect(chips(second)).toEqual(["Erik Lund· from the transcript", "Anna Berg", "Sara Ek"]);
    const chip = within(first).getAllByTestId("speaker-suggestion")[0];
    expect(chip.getAttribute("data-source")).toBe("transcript");
    expect(chip.getAttribute("aria-label")).toBe("Use the name Anna Berg for Speaker 1 (said in the transcript)");
    expect(chip.getAttribute("aria-pressed")).toBe("false");

    // Nothing has been filled in.
    expect(nameField(dialog, "Speaker 1").value).toBe("");
    expect(nameField(dialog, "Speaker 2").value).toBe("");

    // A click fills that one field, and takes the name off the other voice's participant chips.
    fireEvent.click(chip);
    expect(nameField(dialog, "Speaker 1").value).toBe("Anna Berg");
    expect(nameField(dialog, "Speaker 2").value).toBe("");
    expect(within(voiceRows(dialog)[0]).getAllByTestId("speaker-suggestion")[0].getAttribute("aria-pressed")).toBe("true");
    expect(chips(voiceRows(dialog)[1])).toEqual(["Erik Lund· from the transcript", "Sara Ek"]);
  });

  it("with voices remembered, shows voice matches as “Likely” / “Possibly” chips that fill the field only when clicked", async () => {
    await seed(PLAIN);
    useSpeakersStore.setState({ rememberVoices: true });
    backend.profiles = [
      {
        id: "vp-anna",
        name: "Anna Berg",
        is_me: false,
        created_at: "2026-11-01T09:00:00Z",
        updated_at: "2026-11-01T09:00:00Z",
        sources: [],
        model: "m",
        exemplar_count: 1,
        usable: true,
      },
    ];
    backend.match = () => [
      {
        label: "speaker-1",
        candidates: [
          { profile_id: "vp-anna", name: "Anna Berg", is_me: false, score: 0.71, confidence: "likely", participant: false },
          { profile_id: "vp-sara", name: "Sara Ek", is_me: false, score: 0.44, confidence: "possible", participant: false },
        ],
      },
      { label: "speaker-2", candidates: [] },
    ];
    await mountView();
    const dialog = await identify();

    // The match was asked with the setting as consent, the embeddings, and the analysis' model.
    expect(backend.argsOf("voice_profiles_match")).toHaveLength(1);
    const asked = backend.argsOf("voice_profiles_match")[0];
    expect(asked.consent).toBe(true);
    expect(asked.model).toBe("wespeaker-voxceleb-resnet34-lm");
    expect(asked.participants).toBeNull();
    expect((asked.speakers as Array<{ label: string; embedding: number[] }>).map((s) => [s.label, s.embedding.length])).toEqual([
      ["speaker-1", 256],
      ["speaker-2", 256],
    ]);

    const [first] = voiceRows(dialog);
    expect(chips(first)).toEqual(["Likely Anna Berg", "Possibly Sara Ek"]);
    const likely = within(first).getAllByTestId("speaker-suggestion")[0];
    expect(likely.getAttribute("aria-label")).toBe(
      "Use the name Anna Berg for Speaker 1 (sounds like a voice you have remembered)",
    );
    // NOT applied: a voice match is a suggestion.
    expect(nameField(dialog, "Speaker 1").value).toBe("");
    const remember = within(first).getByRole("checkbox", { name: "Remember this voice" });
    expect(remember.getAttribute("aria-checked")).toBe("false");
    expect((remember as HTMLButtonElement).disabled).toBe(true);
    expect(first.textContent).toContain("Give the voice a name to remember it.");

    fireEvent.click(likely);
    expect(nameField(dialog, "Speaker 1").value).toBe("Anna Berg");
    // Named now, so remembering is on by default; the unnamed voice's is not.
    expect(within(voiceRows(dialog)[0]).getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
    expect(within(voiceRows(dialog)[1]).getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    assertNoEmbeddingPersistedOrRendered();
  });
});

// ===========================================================================
// Saving
// ===========================================================================

describe("Identify speakers — saving", () => {
  it("writes segments.json and speakers.json and regenerates an untouched transcript in place", async () => {
    const path = await seed(PLAIN);
    await writeSpeakers(DIR, {}, { participants: ["Anna Berg", "Erik Lund"] });
    await mountView();
    const dialog = await identify();
    fireEvent.change(nameField(dialog, "Speaker 1"), { target: { value: "Anna Berg" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));

    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    // No question was asked: nobody had typed in the transcript.
    expect(screen.queryByTestId("replace-transcript-dialog")).toBeNull();

    const segments = parseSegmentsFile(disk.files.get(`${DIR}/segments.json`)!)!;
    expect(segments.map((s) => s.speaker)).toEqual(["speaker-1", "speaker-2", "speaker-1", "speaker-2"]);
    expect(segments.map((s) => s.text)).toEqual(PLAIN.map((s) => s.text));
    expect(json("speakers.json")).toEqual({
      version: 1,
      names: { "speaker-1": "Anna Berg" },
      labels: ["speaker-1", "speaker-2"],
      participants: ["Anna Berg", "Erik Lund"],
    });

    // The same file, now with turns: the named voice by name, the other as "Speaker 2".
    expect(transcriptFile()).toBe(path.slice(DIR.length + 1));
    expect(transcript()).toContain("**Anna Berg** [00:00:00] Okay, shall we start? This is Anna from marketing.");
    expect(transcript()).toContain("**Speaker 2** [00:00:06] Hej, jag heter Erik Lund.");
    expect(Object.keys(files()).filter((f) => f.endsWith(".md"))).toHaveLength(1);
    expect(toastSuccess).toHaveBeenCalledWith("Speakers saved in the transcript.", expect.anything());
    await waitFor(() =>
      expect(within(screen.getByTestId("recording-row")).getByTestId("recording-speakers").textContent).toBe(
        "Speakers: Anna Berg, Speaker 2",
      ),
    );

    // Voices are not remembered: nothing was compared, nothing saved, no consent sent.
    expect(backend.argsOf("voice_profiles_match")).toHaveLength(0);
    expect(backend.argsOf("voice_profile_save")).toHaveLength(0);
    expect(consentedCalls()).toEqual([]);
    // The result (and its voiceprints) is dropped from memory once used.
    expect(preparedAnalysisDirs()).toEqual([]);
    expect(useSpeakersStore.getState().prepared).toEqual({});
    assertNoEmbeddingOnDisk();
    assertNoEmbeddingPersistedOrRendered();
  });

  it("a name left as “Speaker 2”, or left empty, is not stored, so it keeps following the app's language", async () => {
    await seed(PLAIN);
    await mountView();
    const dialog = await identify();
    fireEvent.change(nameField(dialog, "Speaker 2"), { target: { value: "Speaker 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(json("speakers.json").names).toEqual({});
    expect(transcript()).toContain("**Speaker 1** [00:00:00]");

    setLocale("sv");
    await act(async () => {
      await useRecordingsStore.getState().load();
    });
    expect(within(screen.getByTestId("recording-row")).getByTestId("recording-speakers").textContent).toBe(
      "Talare: Talare 1, Talare 2",
    );
  });

  it("remembers only the ticked voices, with consent, the voiceprint from the analysis, and its model", async () => {
    await seed(PLAIN);
    useSpeakersStore.setState({ rememberVoices: true });
    await mountView();
    const dialog = await identify();
    fireEvent.change(nameField(dialog, "Speaker 1"), { target: { value: "Anna Berg" } });
    fireEvent.change(nameField(dialog, "Speaker 2"), { target: { value: "Erik Lund" } });
    // Both are named, so both boxes are ticked; the user unticks Erik.
    const boxes = within(dialog).getAllByRole("checkbox", { name: "Remember this voice" });
    expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "true"]);
    fireEvent.click(boxes[1]);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());

    const saved = backend.argsOf("voice_profile_save");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({
      consent: true,
      name: "Anna Berg",
      embedding: mockEmbedding(1),
      source: { kind: "manual", recording: DIR },
      profileId: null,
      isMe: null,
      model: "wespeaker-voxceleb-resnet34-lm",
    });
    expect(backend.profiles.map((p) => p.name)).toEqual(["Anna Berg"]);
    expect(toastSuccess).toHaveBeenCalledWith("Speakers saved in the transcript. 1 voice remembered.", expect.anything());
    // Both names are in the transcript all the same.
    expect(json("speakers.json").names).toEqual({ "speaker-1": "Anna Berg", "speaker-2": "Erik Lund" });
    assertNoEmbeddingOnDisk();
    assertNoEmbeddingPersistedOrRendered();
  });

  it("a confirmed voice suggestion is added to THAT stored voice; typing another name lets go of it", async () => {
    await seed(PLAIN);
    useSpeakersStore.setState({ rememberVoices: true });
    const stored = (id: string, name: string) => ({
      id,
      name,
      is_me: false,
      created_at: "2026-11-01T09:00:00Z",
      updated_at: "2026-11-01T09:00:00Z",
      sources: [],
      model: "m",
      exemplar_count: 1,
      usable: true,
    });
    backend.profiles = [stored("vp-anna", "Anna Berg"), stored("vp-erik", "Erik Lund")];
    backend.match = () => [
      { label: "speaker-1", candidates: [{ profile_id: "vp-anna", name: "Anna Berg", is_me: false, score: 0.7, confidence: "likely", participant: false }] },
      { label: "speaker-2", candidates: [{ profile_id: "vp-erik", name: "Erik Lund", is_me: false, score: 0.6, confidence: "likely", participant: false }] },
    ];
    await mountView();
    const dialog = await identify();
    fireEvent.click(within(voiceRows(dialog)[0]).getByRole("button", { name: /Use the name Anna Berg/ }));
    // The second suggestion is clicked and then overruled by typing.
    fireEvent.click(within(voiceRows(dialog)[1]).getByRole("button", { name: /Use the name Erik Lund/ }));
    fireEvent.change(nameField(dialog, "Speaker 2"), { target: { value: "Someone Else" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(backend.argsOf("voice_profile_save")).toHaveLength(2));
    expect(backend.argsOf("voice_profile_save").map((a) => [a.name, a.profileId])).toEqual([
      ["Anna Berg", "vp-anna"],
      ["Someone Else", null],
    ]);
  });

  it("a voice with too little speech for a voiceprint cannot be ticked, and is not sent", async () => {
    await seed(PLAIN);
    useSpeakersStore.setState({ rememberVoices: true });
    const original = backend.analyze;
    backend.analyze = (args) => {
      const result = original(args) as { speakers: Array<{ embedding: number[] }> };
      result.speakers[1].embedding = [];
      return result;
    };
    await mountView();
    const dialog = await identify();
    fireEvent.change(nameField(dialog, "Speaker 2"), { target: { value: "Erik Lund" } });
    const box = within(voiceRows(dialog)[1]).getByRole("checkbox");
    expect((box as HTMLButtonElement).disabled).toBe(true);
    expect(voiceRows(dialog)[1].textContent).toContain("Too little clear speech to remember this voice.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(backend.argsOf("voice_profile_save")).toHaveLength(0);
    // Only the voice with a voiceprint was offered for matching.
    expect((backend.argsOf("voice_profiles_match")[0].speakers as unknown[]).length).toBe(1);
  });

  it("an edited transcript is never replaced silently: Cancel writes nothing at all", async () => {
    await seed(PLAIN, { edit: true });
    await mountView();
    const dialog = await identify();
    const before = files();
    fireEvent.change(nameField(dialog, "Speaker 1"), { target: { value: "Anna Berg" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));

    const ask = await screen.findByTestId("replace-transcript-dialog");
    expect(within(ask).getByTestId("replace-transcript-edited")).toBeTruthy();
    expect(files()).toEqual(before);
    fireEvent.click(within(ask).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("replace-transcript-dialog")).toBeNull());
    expect(files()).toEqual(before);
    // Still on the result screen, with what was typed.
    expect(screen.getByTestId("identify-speakers-dialog").getAttribute("data-view")).toBe("results");
    expect(nameField(screen.getByTestId("identify-speakers-dialog"), "Speaker 1").value).toBe("Anna Berg");
  });

  it("an edited transcript: Keep both writes the new one beside it and leaves the edited one alone", async () => {
    const path = await seed(PLAIN, { edit: true });
    const edited = disk.files.get(path)!;
    await mountView();
    const dialog = await identify();
    fireEvent.change(nameField(dialog, "Speaker 1"), { target: { value: "Anna Berg" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    fireEvent.click(within(await screen.findByTestId("replace-transcript-dialog")).getByRole("button", { name: "Keep both" }));

    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(disk.files.get(path)).toBe(edited);
    const notes = Object.keys(files()).filter((f) => f.endsWith(".md"));
    expect(notes).toHaveLength(2);
    expect(transcript()).toContain("**Anna Berg** [00:00:00]");
    expect(transcript()).not.toContain("A note I typed myself.");
    expect(toastSuccess).toHaveBeenCalledWith("Speakers saved in a new transcript beside the old one.", expect.anything());
  });

  it("an edited transcript: Replace regenerates it, because the user said so", async () => {
    const path = await seed(PLAIN, { edit: true });
    await mountView();
    const dialog = await identify();
    fireEvent.change(nameField(dialog, "Speaker 1"), { target: { value: "Anna Berg" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    fireEvent.click(within(await screen.findByTestId("replace-transcript-dialog")).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(disk.files.get(path)).toContain("**Anna Berg** [00:00:00]"));
    expect(disk.files.get(path)).not.toContain("A note I typed myself.");
    expect(Object.keys(files()).filter((f) => f.endsWith(".md"))).toHaveLength(1);
  });
});

// ===========================================================================
// Two tracks
// ===========================================================================

describe("Identify speakers — a microphone + system-audio recording", () => {
  it("sends both tracks, treats the microphone as “Me”, and analyses the microphone only when asked to", async () => {
    await seedTwoTrack();
    await mountView();
    let dialog = await openIdentify();
    const shared = within(dialog).getByRole("checkbox", { name: "More than one person used my microphone" });
    expect(shared.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));

    const first = backend.argsOf("analyze_speakers")[0];
    expect(first.tracks).toEqual([
      { role: "mic", path: `${DIR}/mic.m4a` },
      { role: "system", path: `${DIR}/system.m4a` },
    ]);
    expect(first.sharedMicrophone).toBe(false);
    expect(first.segments).toEqual(TWO_TRACK);

    // "Me" is listed first and is not something to guess: it is the microphone.
    const rows = voiceRows(dialog);
    expect(rows.map((row) => within(row).getByRole("textbox").getAttribute("aria-label"))).toEqual([
      "Name for Me",
      "Name for Speaker 1",
      "Name for Speaker 2",
    ]);
    expect(within(dialog).getByTestId("identify-count").textContent).toBe("3 voices found. “Me” is your microphone.");
    // The sample of a remote voice comes from the system track.
    fireEvent.click(within(dialog).getByRole("button", { name: "Play sample of Speaker 1" }));
    await waitFor(() => expect(backend.argsOf("extract_audio_clip")).toHaveLength(1));
    expect(backend.argsOf("extract_audio_clip")[0].audioPath).toBe(`${DIR}/system.m4a`);

    // Again, this time saying the microphone was shared.
    fireEvent.click(within(dialog).getByRole("button", { name: "Analyse again…" }));
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("setup"));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "More than one person used my microphone" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Find voices" }));
    await waitFor(() => expect(backend.argsOf("analyze_speakers")).toHaveLength(2));
    expect(backend.argsOf("analyze_speakers")[1].sharedMicrophone).toBe(true);
    dialog = screen.getByTestId("identify-speakers-dialog");
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));
    expect(within(dialog).queryByLabelText("Name for Me")).toBeNull();
  });

  it("saves the others by name and leaves “Me” following the app's language", async () => {
    await seedTwoTrack();
    await mountView();
    const dialog = await identify();
    const [, s1, s2] = voiceRows(dialog);
    // Each remote voice introduced itself, and the name is offered for THAT voice.
    expect(chips(s1)).toEqual(["Erik· from the transcript"]);
    expect(chips(s2)).toEqual(["Anna Berg· from the transcript"]);
    fireEvent.click(within(s2).getByTestId("speaker-suggestion"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());

    const segments = parseSegmentsFile(disk.files.get(`${DIR}/segments.json`)!)!;
    expect(segments.map((s) => s.speaker)).toEqual(["me", "speaker-2", "speaker-1", "me"]);
    expect(json("speakers.json")).toMatchObject({ names: { "speaker-2": "Anna Berg" }, labels: ["me", "speaker-1", "speaker-2"] });
    expect(transcript()).toContain("**Me** [00:00:00] Welcome everyone.");
    expect(transcript()).toContain("**Anna Berg** [00:00:06] Thanks. My name is Anna Berg.");
    expect(transcript()).toContain("**Speaker 1** [00:00:12] And Erik here, hello.");
    assertNoEmbeddingOnDisk();
  });

  it("remembering “Me” adds to the user's own voice without renaming it", async () => {
    await seedTwoTrack();
    useSpeakersStore.setState({ rememberVoices: true });
    backend.profiles = [
      {
        id: "vp-me",
        name: "Peter",
        is_me: true,
        created_at: "2026-11-01T09:00:00Z",
        updated_at: "2026-11-01T09:00:00Z",
        sources: [],
        model: "m",
        exemplar_count: 1,
        usable: true,
      },
    ];
    await mountView();
    const dialog = await identify();
    const me = voiceRows(dialog)[0];
    const box = within(me).getByRole("checkbox", { name: "Remember this voice" });
    // Not named by the user, so not ticked by default; but it CAN be ticked without a name.
    expect(box.getAttribute("aria-checked")).toBe("false");
    expect((box as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(box);
    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(backend.argsOf("voice_profile_save")).toHaveLength(1));
    expect(backend.argsOf("voice_profile_save")[0]).toMatchObject({ consent: true, name: "Peter", isMe: true, profileId: null });
    expect(backend.profiles).toHaveLength(1);
    expect(backend.profiles[0]).toMatchObject({ name: "Peter", exemplar_count: 2 });
    // "Me" itself was not stored as a name.
    expect(json("speakers.json").names).toEqual({});
  });
});

// ===========================================================================
// Analysing again
// ===========================================================================

describe("Identify speakers — a recording that already has names", () => {
  /** A recording identified before: speaker-1 is Anna, speaker-2 is Erik. */
  const IDENTIFIED: Segment[] = PLAIN.map((s, i) => ({ ...s, speaker: `speaker-${(i % 2) + 1}` }));

  async function seedIdentified(options: { edit?: boolean } = {}) {
    addBundle(disk, NAME, { manifest: { title: TITLE } });
    await writeSpeakers(DIR, { "speaker-1": "Anna Berg", "speaker-2": "Erik Lund" }, { labels: ["speaker-1", "speaker-2"] });
    const written = await writeTranscript({ bundleDir: DIR, segments: IDENTIFIED });
    if (options.edit) disk.files.set(written.path, disk.files.get(written.path)!.replace("First point is the budget.", "First point: THE BUDGET."));
    return written.path;
  }
  /** The same voices, numbered the other way round this time. */
  function renumber() {
    const original = backend.analyze;
    backend.analyze = (args) => {
      const swap = (label: string) => (label === "speaker-1" ? "speaker-2" : label === "speaker-2" ? "speaker-1" : label);
      const result = original(args) as {
        turns: Array<{ speaker: string }>;
        speakers: Array<{ label: string }>;
        segments: Array<{ speaker: string }>;
      };
      result.segments = result.segments.map((s) => ({ ...s, speaker: swap(s.speaker) }));
      result.turns = result.turns.map((t) => ({ ...t, speaker: swap(t.speaker) }));
      return result;
    };
  }

  it("shows “Anna Berg, Erik Lund” on the row and offers both in the rename dialog", async () => {
    await seedIdentified();
    await mountView();
    expect(within(screen.getByTestId("recording-row")).getByTestId("recording-speakers").textContent).toBe(
      "Speakers: Anna Berg, Erik Lund",
    );
    openMenu(screen.getByRole("button", { name: `More actions: ${TITLE}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Speakers" }));
    const rename = await screen.findByTestId("speakers-dialog");
    expect((await within(rename).findByLabelText("Name for Anna Berg")) as HTMLInputElement).toBeTruthy();
    expect(within(rename).getByLabelText("Name for Erik Lund")).toBeTruthy();
  });

  it("the rename dialog shows an unnamed voice as “Speaker 2” and does not store that as its name", async () => {
    addBundle(disk, NAME, { manifest: { title: TITLE } });
    await writeSpeakers(DIR, { "speaker-1": "Anna Berg" }, { labels: ["speaker-1", "speaker-2"] });
    await writeTranscript({ bundleDir: DIR, segments: IDENTIFIED });
    await mountView();
    openMenu(screen.getByRole("button", { name: `More actions: ${TITLE}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Speakers" }));
    const rename = await screen.findByTestId("speakers-dialog");
    const second = (await within(rename).findByLabelText("Name for Speaker 2")) as HTMLInputElement;
    expect(second.value).toBe("Speaker 2");
    fireEvent.change(within(rename).getByLabelText("Name for Anna Berg"), { target: { value: "Anna B" } });
    fireEvent.click(within(rename).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(json("speakers.json").names).toEqual({ "speaker-1": "Anna B" }));
    // Renaming keeps what else the file holds.
    expect(json("speakers.json").labels).toEqual(["speaker-1", "speaker-2"]);
    expect(transcript()).toContain("**Speaker 2** [00:00:06]");
  });

  it("keeps the user's names on the same voices even when the analysis numbers them differently", async () => {
    await seedIdentified();
    renumber();
    await mountView();
    const dialog = await identify();
    // What was speaker-1 (Anna) is speaker-2 now, and the name went with the voice.
    expect(nameField(dialog, "Speaker 2").value).toBe("Anna Berg");
    expect(nameField(dialog, "Speaker 1").value).toBe("Erik Lund");
    expect(within(dialog).getAllByTestId("speaker-kept")).toHaveLength(2);

    fireEvent.click(within(dialog).getByRole("button", { name: "Save names" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());
    expect(json("speakers.json").names).toEqual({ "speaker-1": "Erik Lund", "speaker-2": "Anna Berg" });
    // Every line still has the name it had.
    expect(transcript()).toContain("**Anna Berg** [00:00:00] Okay, shall we start?");
    expect(transcript()).toContain("**Erik Lund** [00:00:06] Hej, jag heter Erik Lund.");
  });

  it("an edited transcript can have just its names updated where turns begin, keeping the user's text and its segments", async () => {
    const path = await seedIdentified({ edit: true });
    const segmentsBefore = disk.files.get(`${DIR}/segments.json`);
    renumber();
    await mountView();
    const dialog = await identify();
    // No change yet, so there is nothing to offer.
    expect(within(dialog).queryByRole("button", { name: "Update names in text" })).toBeNull();

    fireEvent.change(nameField(dialog, "Speaker 2"), { target: { value: "Anna Lindqvist" } });
    expect(within(dialog).getByTestId("identify-edited").textContent).toContain("edited by hand");
    fireEvent.click(within(dialog).getByRole("button", { name: "Update names in text" }));
    await waitFor(() => expect(screen.queryByTestId("identify-speakers-dialog")).toBeNull());

    const text = disk.files.get(path)!;
    expect(text).toContain("**Anna Lindqvist** [00:00:00] Okay, shall we start?");
    expect(text).toContain("**Anna Lindqvist** [00:00:12] Great. First point: THE BUDGET.");
    expect(text).toContain("**Erik Lund** [00:00:06]");
    // The mention of a name inside what somebody said is not touched.
    expect(text).toContain("This is Anna from marketing.");
    // The transcript's own labels and segments stay as they were; the new name is under the OLD label.
    expect(disk.files.get(`${DIR}/segments.json`)).toBe(segmentsBefore);
    expect(json("speakers.json").names).toEqual({ "speaker-1": "Anna Lindqvist", "speaker-2": "Erik Lund" });
    expect(toastSuccess).toHaveBeenCalledWith("Updated 2 places in the transcript", expect.anything());
    expect(screen.queryByTestId("replace-transcript-dialog")).toBeNull();
  });

  it("does not offer the text-only update for a voice the old transcript did not tell apart", async () => {
    await seedTwoTrack({ edit: true });
    await mountView();
    const dialog = await identify();
    // Two voices were found inside "Others": neither IS "Others".
    fireEvent.change(nameField(dialog, "Speaker 1"), { target: { value: "Erik Lund" } });
    fireEvent.change(nameField(dialog, "Speaker 2"), { target: { value: "Anna Berg" } });
    expect(within(dialog).queryByRole("button", { name: "Update names in text" })).toBeNull();
    // "Me" is the same speaker in both, so renaming it can be done in the text.
    fireEvent.change(nameField(dialog, "Me"), { target: { value: "Peter" } });
    expect(within(dialog).getByRole("button", { name: "Update names in text" })).toBeTruthy();
  });
});

// ===========================================================================
// Teams
// ===========================================================================

describe("Learning voices from a Teams transcript", () => {
  async function mergeTeams() {
    addBundle(disk, NAME, { manifest: { title: TITLE } });
    await writeTranscript({ bundleDir: DIR, segments: TEAMS_OURS });
    disk.files.set("/Users/peter/Downloads/meeting.vtt", TEAMS_VTT);
    disk.pick = "/Users/peter/Downloads/meeting.vtt";
    await mountView();
    openMenu(screen.getByRole("button", { name: `More actions: ${TITLE}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Add Teams transcript…" }));
    const dialog = await screen.findByTestId("teams-dialog");
    const add = await within(dialog).findByRole("button", { name: "Add to recording" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    // The existing transcript is untouched by a person: no question, but the
    // guard still asks because one exists.
    const ask = await screen.findByTestId("replace-transcript-dialog");
    fireEvent.click(within(ask).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(`Teams transcript added to “${TITLE}”`, expect.anything()));
  }

  it("offers nothing unless both opt-ins are on", async () => {
    await mergeTeams();
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastInfo).not.toHaveBeenCalled();
    expect(backend.argsOf("embed_speaker_turns")).toHaveLength(0);

    // Remembering on, learning from Teams still off: still nothing.
    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: false });
  });

  it("with remembering on but learning from Teams off, offers nothing", async () => {
    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: false });
    await mergeTeams();
    await act(async () => {
      await Promise.resolve();
    });
    expect(toastInfo).not.toHaveBeenCalled();
    expect(consentedCalls()).toEqual([]);
  });

  it("with both on, offers “Remember these N voices” as a toast action, and does nothing until it is clicked", async () => {
    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: true });
    await mergeTeams();
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    const [message, options] = toastInfo.mock.calls[0] as [string, { description: string; action: { label: string; onClick: () => void } }];
    expect(message).toBe(`Remember the voices in “${TITLE}”?`);
    const named = [...new Set(parseSegmentsFile(disk.files.get(`${DIR}/segments.json`)!)!.map((s) => s.speaker).filter(Boolean))] as string[];
    expect(named.length).toBeGreaterThan(1);
    expect(options.action.label).toBe(`Remember these ${named.length} voices`);
    for (const name of named) expect(options.description).toContain(name);
    // An offer is not an action.
    expect(backend.argsOf("embed_speaker_turns")).toHaveLength(0);
    expect(backend.argsOf("voice_profile_save")).toHaveLength(0);

    // One person had too little clear speech.
    const skippedName = named[named.length - 1];
    const original = backend.embed;
    backend.embed = (args) => {
      const result = original(args) as { speakers: Array<{ speaker: string }>; skipped: unknown[] };
      result.speakers = result.speakers.filter((s) => s.speaker !== skippedName);
      result.skipped = [{ speaker: skippedName, reason: "Too little clean speech: 2.1 s, need 6 s", total_secs: 2.1 }];
      return result;
    };
    await act(async () => {
      options.action.onClick();
      await Promise.resolve();
    });
    await waitFor(() => expect(backend.argsOf("voice_profile_save")).toHaveLength(named.length - 1));

    const sent = backend.argsOf("embed_speaker_turns")[0];
    expect(sent.audioPath).toBe(`${DIR}/audio.m4a`);
    const turns = sent.turns as Array<{ start: number; end: number; speaker: string }>;
    expect(turns.length).toBeGreaterThan(0);
    expect(new Set(turns.map((turn) => turn.speaker))).toEqual(new Set(named));
    for (const turn of turns) expect(turn.end).toBeGreaterThan(turn.start);

    for (const save of backend.argsOf("voice_profile_save")) {
      expect(save).toMatchObject({ consent: true, source: { kind: "teams", recording: DIR }, profileId: null, isMe: null });
      expect((save.embedding as number[]).length).toBe(256);
      expect(named).toContain(save.name);
    }
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(2));
    const report = String(toastSuccess.mock.calls[1][0]);
    expect(report).toContain(`Remembered ${named.length - 1} voice`);
    expect(report).toContain(`Skipped 1: ${skippedName} (too little clear speech).`);
    assertNoEmbeddingOnDisk();
    assertNoEmbeddingPersistedOrRendered();
  });

  it("if the setting is switched off before the offer is accepted, nothing is embedded or saved", async () => {
    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: true });
    await mergeTeams();
    await waitFor(() => expect(toastInfo).toHaveBeenCalledTimes(1));
    const options = toastInfo.mock.calls[0][1] as { action: { onClick: () => void } };
    useSpeakersStore.getState().setRememberVoices(false);
    await act(async () => {
      options.action.onClick();
      await Promise.resolve();
    });
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(backend.argsOf("embed_speaker_turns")).toHaveLength(0);
    expect(backend.argsOf("voice_profile_save")).toHaveLength(0);
  });
});

// ===========================================================================
// Automatically after transcription
// ===========================================================================

describe("Identify speakers automatically after transcription", () => {
  async function transcribeNow() {
    addBundle(disk, NAME, { manifest: { title: TITLE, autoTranscribe: false } });
    renderHook(() => useTranscriptionJob());
    await mountView();
    await act(async () => {
      await useRecordingsStore.getState().transcribe(DIR);
    });
    await waitFor(() => expect(useActivityStore.getState().tasks.some((t) => t.status === "done")).toBe(true));
  }

  it("is off by default: a finished transcription is not followed by an analysis", async () => {
    await transcribeNow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(backend.argsOf("analyze_speakers")).toHaveLength(0);
    expect(screen.queryByTestId("recording-speaker-suggestions")).toBeNull();
  });

  it("when on, it prepares suggestions and changes nothing in the recording until the user confirms", async () => {
    useSpeakersStore.setState({ autoIdentify: true });
    disk.transcribe = () => ({
      segments: PLAIN.map((s) => ({ ...s, speaker: null })),
      duration_secs: 24,
      language: "en",
      decoder: "mock",
    });
    await transcribeNow();
    await waitFor(() => expect(backend.argsOf("analyze_speakers")).toHaveLength(1));
    const link = await within(await screen.findByTestId("recording-speaker-suggestions")).findByRole("button");
    expect(link.textContent).toBe("Speaker names suggested");

    // Nothing in the bundle says anything about speakers yet.
    expect(disk.files.has(`${DIR}/speakers.json`)).toBe(false);
    expect(parseSegmentsFile(disk.files.get(`${DIR}/segments.json`)!)!.every((s) => s.speaker === undefined)).toBe(true);
    expect(transcript()).not.toContain("**");
    // Voices are not remembered: nothing was compared.
    expect(consentedCalls()).toEqual([]);
    expect(getPreparedAnalysis(DIR)?.matches).toBeNull();
    assertNoEmbeddingOnDisk();
    assertNoEmbeddingPersistedOrRendered();

    // Opening it lands on the voices, without analysing again.
    fireEvent.click(link);
    const dialog = await screen.findByTestId("identify-speakers-dialog");
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));
    expect(backend.argsOf("analyze_speakers")).toHaveLength(1);
    expect(nameField(dialog, "Speaker 1").value).toBe("");
  });

  it("when on but the voice model is not installed, it does nothing and reports nothing", async () => {
    useSpeakersStore.setState({ autoIdentify: true });
    backend.modelInstalled = false;
    await transcribeNow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(backend.argsOf("analyze_speakers")).toHaveLength(0);
    expect(toastError).not.toHaveBeenCalled();
    expect(useSpeakersStore.getState().jobErrors).toEqual({});
  });
});

// ===========================================================================
// Swedish
// ===========================================================================

describe("Identify speakers — in Swedish", () => {
  it("has the action, the dialog, the voices and the suggestions in Swedish", async () => {
    setLocale("sv");
    await seed(PLAIN);
    useSpeakersStore.setState({ rememberVoices: true });
    backend.match = () => [
      {
        label: "speaker-1",
        candidates: [
          { profile_id: "vp-anna", name: "Anna", is_me: false, score: 0.7, confidence: "likely", participant: false },
          { profile_id: "vp-sara", name: "Sara", is_me: false, score: 0.45, confidence: "possible", participant: false },
        ],
      },
    ];
    await mountView();
    openMenu(screen.getByRole("button", { name: `Fler åtgärder: ${TITLE}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Identifiera talare…" }));
    const dialog = await screen.findByTestId("identify-speakers-dialog");
    expect(within(dialog).getByRole("heading", { name: "Identifiera talare" })).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Hitta röster" }));
    await waitFor(() => expect(dialog.getAttribute("data-view")).toBe("results"));

    expect(within(dialog).getByLabelText("Namn för Talare 1")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Spela upp ett prov av Talare 2" })).toBeTruthy();
    expect(chips(voiceRows(dialog)[0]).slice(0, 2)).toEqual(["Troligen Anna", "Möjligen Sara"]);
    expect(within(dialog).getAllByRole("checkbox", { name: "Kom ihåg den här rösten" })).toHaveLength(2);
    expect(voiceRows(dialog)[0].textContent).toContain("Talade i 0:02:00");
    const text = dialog.textContent ?? "";
    for (const english of ["Speaker", "Likely", "Possibly", "Remember", "Save", "Cancel", "voices"]) {
      expect(text, english).not.toContain(english);
    }
  });
});
