// @vitest-environment jsdom

/**
 * Settings → Transcription → Speakers, against the in-memory voice backend.
 *
 * The backend mock refuses the consent-gated commands unless `consent` is
 * exactly `true`, like the real one, and logs every call with its arguments,
 * so "nothing was sent with consent while the setting was off" is asserted on
 * what was actually received.
 */

import "@/test/local-storage";
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { toast } from "sonner";
import { act, fireEvent, renderWithProviders, screen, waitFor, within } from "@/test/component-harness";
import {
  emitMockEvent,
  registerSpeakerHandlers,
  setMockInvokeHandler,
  type MockVoiceProfile,
  type SpeakerMockState,
} from "@/test/tauri-mock";
import { ENROL_RECORD_SECS, VoiceProfilesSettings } from "@/components/recordings/VoiceProfilesSettings";
import { TranscriptionSettings } from "@/components/settings/TranscriptionSettings";
import { clearAllPreparedAnalyses } from "@/lib/speakers/analysis-cache";
import { setLocale } from "@/lib/i18n";
import { useRecordingStore } from "@/stores/recording-store";
import { SPEAKERS_SETTINGS_SECTION_ID, openSpeakerSettings, useSpeakersStore } from "@/stores/speakers-store";

const toastError = toast.error as ReturnType<typeof vi.fn>;
const toastSuccess = toast.success as ReturnType<typeof vi.fn>;

for (const m of ["hasPointerCapture", "releasePointerCapture", "setPointerCapture", "scrollIntoView"] as const) {
  if (!(m in HTMLElement.prototype)) {
    Object.defineProperty(HTMLElement.prototype, m, { configurable: true, value: vi.fn(() => false) });
  }
}

const STAGING = "/Users/me/.notesage/recordings-staging/Recording 2026-11-26 090000";

function profile(over: Partial<MockVoiceProfile> & { id: string; name: string }): MockVoiceProfile {
  return {
    is_me: false,
    created_at: "2026-11-20T09:00:00Z",
    updated_at: "2026-11-21T09:00:00Z",
    sources: [{ kind: "manual", recording: "/rec/a", at: "2026-11-20T09:00:00Z" }],
    model: "wespeaker-voxceleb-resnet34-lm",
    exemplar_count: 2,
    usable: true,
    ...over,
  };
}

const ANNA = profile({ id: "vp-anna", name: "Anna Berg" });
const ERIK = profile({
  id: "vp-erik",
  name: "Erik Lund",
  exemplar_count: 1,
  sources: [{ kind: "teams", recording: "/rec/b", at: "2026-11-22T09:00:00Z" }],
});

let backend: SpeakerMockState;
/** Recording commands the "record my voice" flow reaches. */
let recorder: { calls: string[]; deleted: string[]; startError: string | null };

function install(initial: Parameters<typeof registerSpeakerHandlers>[0] = {}) {
  backend = registerSpeakerHandlers(initial);
  recorder = { calls: [], deleted: [], startError: null };
  setMockInvokeHandler("start_recording", () => {
    recorder.calls.push("start_recording");
    if (recorder.startError) throw new Error(recorder.startError);
  });
  setMockInvokeHandler("stop_recording", () => {
    recorder.calls.push("stop_recording");
    return {
      bundle_dir: STAGING,
      audio_path: `${STAGING}/audio.m4a`,
      tracks: [],
      duration_secs: 15,
      peak: 0.4,
      sample_rate: 48_000,
      dropped_frames: 0,
      warnings: [],
    };
  });
  setMockInvokeHandler("discard_recording", (args) => {
    // With a bundle: the finished sample being deleted. Without: a live capture abandoned.
    if (args?.bundleDir) recorder.deleted.push(String(args.bundleDir));
    else recorder.calls.push("discard_recording");
  });
  setMockInvokeHandler("open_file_dialog", () => "/Users/me/Desktop/me-talking.m4a");
}

async function mount() {
  const view = renderWithProviders(<VoiceProfilesSettings />);
  await waitFor(() => expect(useSpeakersStore.getState().profilesLoaded).toBe(true));
  await waitFor(() => expect(useSpeakersStore.getState().modelsInstalled).not.toBeNull());
  return view;
}

function rememberSwitch(): HTMLElement {
  return screen.getByRole("switch", { name: "Remember voices on this Mac" });
}

/** Every call the backend received with `consent: true`. */
function consentedCalls(): string[] {
  return backend.calls.filter((call) => call.args.consent === true).map((call) => call.cmd);
}

function openMenu(trigger: HTMLElement) {
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.pointerUp(trigger, { button: 0 });
    fireEvent.click(trigger);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearAllPreparedAnalyses();
  setLocale("en");
  useSpeakersStore.setState(useSpeakersStore.getInitialState(), true);
  useRecordingStore.setState({ phase: "idle" });
  install();
});

afterEach(() => {
  vi.useRealTimers();
  setLocale(null);
});

// ===========================================================================
// The opt-in
// ===========================================================================

describe("Remember voices on this Mac — the opt-in", () => {
  it("is off by default, and nothing about it is on in the saved settings", async () => {
    await mount();
    expect(rememberSwitch().getAttribute("aria-checked")).toBe("false");
    expect(useSpeakersStore.getState()).toMatchObject({ rememberVoices: false, learnFromTeams: false, autoIdentify: false });
    // The sub-switch does not exist while the main one is off.
    expect(screen.queryByRole("switch", { name: "Learn voices from Teams transcripts" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Identify speakers automatically after transcription" }).getAttribute("aria-checked")).toBe("false");
  });

  it("turning it on shows a plain explanation first, and only the confirmation turns it on", async () => {
    await mount();
    fireEvent.click(rememberSwitch());

    const dialog = await screen.findByTestId("remember-voices-explanation");
    // Still off: the switch asked, it did not decide.
    expect(useSpeakersStore.getState().rememberVoices).toBe(false);
    const text = dialog.textContent ?? "";
    expect(text).toContain("biometric data");
    expect(text).toContain("only on this Mac");
    expect(text).toContain("never synced");
    expect(text).toContain("never sent anywhere");
    expect(text).toContain("consent of the people you record");
    expect(text).toContain("delete");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("remember-voices-explanation")).toBeNull());
    expect(useSpeakersStore.getState().rememberVoices).toBe(false);
    expect(rememberSwitch().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(rememberSwitch());
    fireEvent.click(within(await screen.findByTestId("remember-voices-explanation")).getByRole("button", { name: "Remember voices" }));
    await waitFor(() => expect(useSpeakersStore.getState().rememberVoices).toBe(true));
    expect(rememberSwitch().getAttribute("aria-checked")).toBe("true");
  });

  it("offers “Learn voices from Teams transcripts” only once remembering is on, and it starts off", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    await mount();
    const learn = screen.getByRole("switch", { name: "Learn voices from Teams transcripts" });
    expect(learn.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(learn);
    expect(useSpeakersStore.getState().learnFromTeams).toBe(true);
  });

  it("turning it off with voices stored asks whether to delete them too: keep", async () => {
    install({ profiles: [ANNA, ERIK] });
    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: true });
    await mount();

    fireEvent.click(rememberSwitch());
    const dialog = await screen.findByTestId("remember-voices-off");
    expect(dialog.textContent).toContain("2 voices are stored on this Mac");
    // Nothing has happened yet.
    expect(useSpeakersStore.getState().rememberVoices).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off, keep voices" }));
    await waitFor(() => expect(useSpeakersStore.getState().rememberVoices).toBe(false));
    // Learning from Teams cannot stay on by itself.
    expect(useSpeakersStore.getState().learnFromTeams).toBe(false);
    expect(backend.argsOf("voice_profiles_delete_all")).toHaveLength(0);
    expect(backend.profiles).toHaveLength(2);
    // The stored voices are still listed, and can still be deleted.
    expect(screen.getAllByTestId("known-voice")).toHaveLength(2);
  });

  it("turning it off with voices stored asks whether to delete them too: delete", async () => {
    install({ profiles: [ANNA, ERIK] });
    useSpeakersStore.setState({ rememberVoices: true });
    await mount();

    fireEvent.click(rememberSwitch());
    fireEvent.click(
      within(await screen.findByTestId("remember-voices-off")).getByRole("button", { name: "Turn off and delete voices" }),
    );
    await waitFor(() => expect(backend.argsOf("voice_profiles_delete_all")).toHaveLength(1));
    expect(useSpeakersStore.getState().rememberVoices).toBe(false);
    await waitFor(() => expect(screen.queryAllByTestId("known-voice")).toHaveLength(0));
    expect(backend.profiles).toHaveLength(0);
  });

  it("turning it off with nothing stored just turns it off", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    await mount();
    fireEvent.click(rememberSwitch());
    expect(useSpeakersStore.getState().rememberVoices).toBe(false);
    expect(screen.queryByTestId("remember-voices-off")).toBeNull();
  });

  it("saves the three settings and nothing else", async () => {
    install({ profiles: [ANNA] });
    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: true, autoIdentify: true });
    await mount();
    const saved = JSON.parse(localStorage.getItem("notesage-speakers") ?? "{}") as { state: Record<string, unknown> };
    expect(saved.state).toEqual({ rememberVoices: true, learnFromTeams: true, autoIdentify: true });
  });

  it("a damaged or tampered saved value never turns consent on", async () => {
    const { merge } = useSpeakersStore.persist.getOptions();
    const current = useSpeakersStore.getInitialState();
    for (const stored of [null, "yes", 7, { rememberVoices: "true" }, { rememberVoices: 1, learnFromTeams: true }]) {
      const merged = merge?.(stored, current);
      expect(merged).toMatchObject({ rememberVoices: false, learnFromTeams: false });
    }
    // Learning from Teams needs remembering.
    expect(merge?.({ rememberVoices: false, learnFromTeams: true }, current)).toMatchObject({ learnFromTeams: false });
    expect(merge?.({ rememberVoices: true, learnFromTeams: true, autoIdentify: true }, current)).toMatchObject({
      rememberVoices: true,
      learnFromTeams: true,
      autoIdentify: true,
    });
  });
});

// ===========================================================================
// Consent on the wire
// ===========================================================================

describe("no voiceprint is made or compared while the setting is off", () => {
  it("the “My voice” entry points are disabled, say why, and send nothing", async () => {
    install({ profiles: [ANNA] });
    await mount();

    const record = screen.getByRole("button", { name: "Record my voice" });
    const choose = screen.getByRole("button", { name: "Choose audio file…" });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    expect((choose as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("my-voice-blocked").textContent).toBe("Turn on “Remember voices on this Mac” first.");

    fireEvent.click(record);
    fireEvent.click(choose);
    await act(async () => {
      await Promise.resolve();
    });
    expect(recorder.calls).toEqual([]);
    expect(backend.argsOf("enrol_own_voice")).toHaveLength(0);
    expect(consentedCalls()).toEqual([]);
    // What WAS called needs no consent: reading the model status and the list.
    expect([...new Set(backend.calls.map((call) => call.cmd))].sort()).toEqual(["speaker_models_status", "voice_profiles_list"]);
  });

  it("with the setting on, enrolling from a file passes the setting as consent", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    await mount();

    fireEvent.click(screen.getByRole("button", { name: "Choose audio file…" }));
    await waitFor(() => expect(backend.argsOf("enrol_own_voice")).toHaveLength(1));
    expect(backend.argsOf("enrol_own_voice")[0]).toEqual({
      consent: true,
      audioPath: "/Users/me/Desktop/me-talking.m4a",
      name: null,
    });
    await waitFor(() => expect(screen.getByTestId("my-voice-status").textContent).toContain("Set up from 1 sample"));
    expect(toastSuccess).toHaveBeenCalledWith("Your voice is set up.");
    // The same control now offers a re-enrolment.
    expect((screen.getByRole("button", { name: "Record again" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("if the setting is switched off between the click and the call, the backend's refusal is what the user sees", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    await mount();
    // The dialog is open while the user changes their mind elsewhere.
    setMockInvokeHandler("open_file_dialog", () => {
      useSpeakersStore.setState({ rememberVoices: false });
      return "/Users/me/Desktop/me-talking.m4a";
    });
    fireEvent.click(screen.getByRole("button", { name: "Choose audio file…" }));
    const alert = await screen.findByTestId("my-voice-error");
    expect(alert.textContent).toBe("Remembering voices is turned off. Turn it on in Settings → Transcription → Speakers.");
    expect(backend.argsOf("enrol_own_voice")[0]).toMatchObject({ consent: false });
    expect(backend.profiles).toHaveLength(0);
    expect(consentedCalls()).toEqual([]);
  });

  it("needs the voice model, and says so", async () => {
    install({ modelInstalled: false });
    useSpeakersStore.setState({ rememberVoices: true });
    await mount();
    expect((screen.getByRole("button", { name: "Record my voice" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("my-voice-blocked").textContent).toBe("Download the voice model first.");
  });

  it("is not offered while a meeting is being recorded", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    useRecordingStore.setState({ phase: "recording" });
    await mount();
    expect((screen.getByRole("button", { name: "Record my voice" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("my-voice-blocked").textContent).toBe("A recording is in progress. Finish it first.");
  });
});

// ===========================================================================
// My voice
// ===========================================================================

describe("My voice — enrolling", () => {
  beforeEach(() => {
    useSpeakersStore.setState({ rememberVoices: true });
  });

  it("records with the ordinary recorder, learns from the sample, and deletes the sample", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record my voice" }));
    await screen.findByTestId("my-voice-recording");
    expect(recorder.calls).toEqual(["start_recording"]);

    fireEvent.click(screen.getByRole("button", { name: "Stop and use" }));
    await waitFor(() => expect(backend.argsOf("enrol_own_voice")).toHaveLength(1));
    expect(backend.argsOf("enrol_own_voice")[0]).toEqual({ consent: true, audioPath: `${STAGING}/audio.m4a`, name: null });
    await waitFor(() => expect(recorder.deleted).toEqual([STAGING]));
    expect(recorder.calls).toEqual(["start_recording", "stop_recording"]);
    await waitFor(() => expect(screen.queryByTestId("my-voice-recording")).toBeNull());
    expect(screen.getByTestId("my-voice-status").textContent).toContain("Set up from 1 sample");
  });

  it("stops by itself after the sample length", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record my voice" }));
    await screen.findByTestId("my-voice-recording");
    await act(async () => {
      await vi.advanceTimersByTimeAsync((ENROL_RECORD_SECS + 1) * 1000);
    });
    await waitFor(() => expect(recorder.calls).toEqual(["start_recording", "stop_recording"]));
    await waitFor(() => expect(backend.argsOf("enrol_own_voice")).toHaveLength(1));
  });

  it("shows the backend's “not enough speech” plainly, and still deletes the sample", async () => {
    backend.enrol = () => {
      throw new Error("Not enough speech to learn the voice: found 3.2 s of speech, need at least 8 s");
    };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record my voice" }));
    await screen.findByTestId("my-voice-recording");
    fireEvent.click(screen.getByRole("button", { name: "Stop and use" }));

    const alert = await screen.findByTestId("my-voice-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe(
      "Not enough speech to learn the voice: found 3.2 s, and at least 8 s is needed. Speak for a little longer.",
    );
    await waitFor(() => expect(recorder.deleted).toEqual([STAGING]));
    expect(screen.getByTestId("my-voice-status").textContent).toBe("Not set up.");
    expect(backend.profiles).toHaveLength(0);
  });

  it("shows an error the app does not know word for word as the backend wrote it", async () => {
    backend.enrol = () => {
      throw new Error("Could not open the default input device: device busy");
    };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Choose audio file…" }));
    expect((await screen.findByTestId("my-voice-error")).textContent).toBe(
      "Could not open the default input device: device busy",
    );
  });

  it("a recorder that cannot start says why and records nothing", async () => {
    recorder.startError = "Microphone access is denied";
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record my voice" }));
    expect((await screen.findByTestId("my-voice-error")).textContent).toBe("Microphone access is denied");
    expect(screen.queryByTestId("my-voice-recording")).toBeNull();
    expect(recorder.calls).toEqual(["start_recording"]);
  });

  it("says so when the sample could not be deleted, with where it is", async () => {
    setMockInvokeHandler("discard_recording", () => {
      throw new Error("Operation not permitted");
    });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record my voice" }));
    await screen.findByTestId("my-voice-recording");
    fireEvent.click(screen.getByRole("button", { name: "Stop and use" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect((toast.warning as ReturnType<typeof vi.fn>).mock.calls[0][0]).toContain(STAGING);
  });

  it("leaving Settings mid-sample stops the microphone and discards the sample", async () => {
    const view = await mount();
    fireEvent.click(screen.getByRole("button", { name: "Record my voice" }));
    await screen.findByTestId("my-voice-recording");
    view.unmount();
    expect(recorder.calls).toEqual(["start_recording", "discard_recording"]);
    expect(backend.argsOf("enrol_own_voice")).toHaveLength(0);
  });

  it("removes the stored voice after a confirmation", async () => {
    install({ profiles: [profile({ id: "vp-me", name: "Me", is_me: true, exemplar_count: 3 })] });
    await mount();
    expect(screen.getByTestId("my-voice-status").textContent).toContain("Set up from 3 samples");
    // The user's own voice is not in the list of other people's.
    expect(screen.queryAllByTestId("known-voice")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Remove my voice" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(backend.argsOf("voice_profile_delete")).toEqual([{ profileId: "vp-me" }]));
    await waitFor(() => expect(screen.getByTestId("my-voice-status").textContent).toBe("Not set up."));
  });
});

// ===========================================================================
// Known voices
// ===========================================================================

describe("Known voices", () => {
  beforeEach(() => {
    install({ profiles: [ANNA, ERIK] });
    useSpeakersStore.setState({ rememberVoices: true });
  });

  it("lists each voice with when it was added, where it came from and how many samples", async () => {
    await mount();
    const rows = screen.getAllByTestId("known-voice");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Anna Berg");
    expect(rows[0].textContent).toContain("Added Nov 20, 2026");
    expect(rows[0].textContent).toContain("named in a recording");
    expect(rows[0].textContent).toContain("2 samples");
    expect(rows[1].textContent).toContain("Erik Lund");
    expect(rows[1].textContent).toContain("Teams transcript");
    expect(rows[1].textContent).toContain("1 sample");
    // Each row's menu is named after its voice.
    expect(screen.getByRole("button", { name: "More actions for Anna Berg" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions for Erik Lund" })).toBeTruthy();
  });

  it("renames a voice", async () => {
    await mount();
    openMenu(screen.getByRole("button", { name: "More actions for Anna Berg" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByTestId("rename-voice-dialog");
    const input = within(dialog).getByLabelText("Name of the voice");
    expect((input as HTMLInputElement).value).toBe("Anna Berg");
    fireEvent.change(input, { target: { value: "  Anna  Lindqvist " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Rename" }));

    await waitFor(() =>
      expect(backend.argsOf("voice_profile_rename")).toEqual([{ profileId: "vp-anna", name: "Anna Lindqvist" }]),
    );
    await waitFor(() => expect(screen.getAllByTestId("known-voice")[0].textContent).toContain("Anna Lindqvist"));
  });

  it("merges two voices that are the same person, after saying what will happen", async () => {
    await mount();
    openMenu(screen.getByRole("button", { name: "More actions for Erik Lund" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Merge into" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Anna Berg" }));

    const dialog = await screen.findByTestId("merge-voice-dialog");
    expect(dialog.textContent).toContain("Merge “Erik Lund” into “Anna Berg”?");
    expect(dialog.textContent).toContain("“Anna Berg” keeps its name");
    expect(backend.argsOf("voice_profiles_merge")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(backend.argsOf("voice_profiles_merge")).toEqual([{ intoId: "vp-anna", fromId: "vp-erik" }]));
    await waitFor(() => expect(screen.getAllByTestId("known-voice")).toHaveLength(1));
    expect(screen.getByTestId("known-voice").textContent).toContain("3 samples");
  });

  it("deletes one voice after a confirmation", async () => {
    await mount();
    openMenu(screen.getByRole("button", { name: "More actions for Anna Berg" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    const dialog = await screen.findByTestId("delete-voice-dialog");
    expect(dialog.textContent).toContain("Delete the voice of “Anna Berg”?");
    expect(backend.argsOf("voice_profile_delete")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(backend.argsOf("voice_profile_delete")).toEqual([{ profileId: "vp-anna" }]));
    await waitFor(() => expect(screen.getAllByTestId("known-voice")).toHaveLength(1));
  });

  it("deletes all voices after a confirmation, and cancelling deletes nothing", async () => {
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete all voices…" }));
    let dialog = await screen.findByTestId("delete-all-voices-dialog");
    expect(dialog.textContent).toContain("including your own");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByTestId("delete-all-voices-dialog")).toBeNull());
    expect(backend.argsOf("voice_profiles_delete_all")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Delete all voices…" }));
    dialog = await screen.findByTestId("delete-all-voices-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete all voices…" }));
    await waitFor(() => expect(backend.argsOf("voice_profiles_delete_all")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("known-voices-empty")).toBeTruthy());
    expect(toastSuccess).toHaveBeenCalledWith("All stored voices were deleted.");
    // With nothing left there is nothing to delete.
    expect(screen.queryByRole("button", { name: "Delete all voices…" })).toBeNull();
  });

  it("can still be listed and deleted after opting out", async () => {
    useSpeakersStore.setState({ rememberVoices: false });
    await mount();
    expect(screen.getAllByTestId("known-voice")).toHaveLength(2);
    openMenu(screen.getByRole("button", { name: "More actions for Erik Lund" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    fireEvent.click(within(await screen.findByTestId("delete-voice-dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(backend.argsOf("voice_profile_delete")).toEqual([{ profileId: "vp-erik" }]));
    expect(consentedCalls()).toEqual([]);
  });

  it("reports a change the backend refuses", async () => {
    setMockInvokeHandler("voice_profile_delete", () => {
      throw new Error("Voice profile not found: vp-anna");
    });
    await mount();
    openMenu(screen.getByRole("button", { name: "More actions for Anna Berg" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete…" }));
    fireEvent.click(within(await screen.findByTestId("delete-voice-dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not change the voice: Voice profile not found: vp-anna"));
  });

  it("says when a voice was made with another model", async () => {
    install({ profiles: [{ ...ANNA, usable: false }] });
    await mount();
    expect(screen.getByTestId("known-voice").textContent).toContain("Made with another voice model");
  });
});

// ===========================================================================
// The voice model
// ===========================================================================

describe("The voice model", () => {
  it("shows its size and the licence line the backend gives, and that it is downloaded", async () => {
    await mount();
    const row = screen.getByTestId("voice-model");
    expect(row.textContent).toContain("27 MB");
    expect(screen.getByTestId("voice-model-licence").textContent).toBe(
      "WeSpeaker ResNet34-LM · Licence: CC-BY-4.0 (WeSpeaker, trained on VoxCeleb)",
    );
    expect(row.textContent).toContain("Downloaded");
    expect(within(row).getByRole("button", { name: "Delete the voice model" })).toBeTruthy();
  });

  it("downloads with progress, and can be cancelled", async () => {
    install({ modelInstalled: false });
    let finish: (() => void) | null = null;
    backend.download = () =>
      new Promise<null>((resolve) => {
        finish = () => {
          backend.modelInstalled = true;
          resolve(null);
        };
      });
    await mount();
    const row = screen.getByTestId("voice-model");
    expect(row.textContent).toContain("Not downloaded");

    fireEvent.click(within(row).getByRole("button", { name: "Download the voice model" }));
    await waitFor(() => expect(backend.argsOf("download_speaker_models")).toHaveLength(1));
    const bar = await within(row).findByRole("progressbar", { name: "Downloading the voice model" });
    expect(bar).toBeTruthy();

    act(() => {
      emitMockEvent("speaker-model-download-progress", { model: "wespeaker", downloaded: 13_265_275, total: 26_530_550 });
    });
    await waitFor(() => expect(screen.getByTestId("voice-model-progress").textContent).toContain("50%"));
    expect(screen.getByTestId("voice-model-progress").textContent).toContain("13 of 25 MB");

    fireEvent.click(within(row).getByRole("button", { name: "Cancel the voice model download" }));
    await waitFor(() => expect(backend.argsOf("cancel_speaker_models_download")).toHaveLength(1));

    await act(async () => {
      finish?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId("voice-model").textContent).toContain("Downloaded"));
  });

  it("a failed download says why and offers a retry; a cancelled one is not an error", async () => {
    install({ modelInstalled: false });
    backend.download = () => {
      throw new Error("Download stalled: no data for 30 s");
    };
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Download the voice model" }));
    const alert = await screen.findByTestId("voice-model-error");
    expect(alert.textContent).toBe("Download failed: Download stalled: no data for 30 s");
    const retry = screen.getByRole("button", { name: "Try downloading the voice model again" });

    backend.download = () => {
      throw new Error("Download cancelled");
    };
    fireEvent.click(retry);
    await waitFor(() => expect(backend.argsOf("download_speaker_models")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByTestId("voice-model-error")).toBeNull());
    expect(screen.getByRole("button", { name: "Download the voice model" })).toBeTruthy();
  });

  it("deleting it asks first and says the stored voices are kept", async () => {
    install({ profiles: [ANNA] });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Delete the voice model" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Remembered voices are kept");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(backend.argsOf("delete_speaker_models")).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("voice-model").textContent).toContain("Not downloaded"));
    expect(backend.profiles).toHaveLength(1);
  });

  it("says the feature is unavailable on a backend without it, instead of offering a download that cannot work", async () => {
    setMockInvokeHandler("speaker_models_status", () => {
      throw new Error("Command speaker_models_status not found");
    });
    await mount();
    expect(screen.getByTestId("voice-model-unavailable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download the voice model" })).toBeNull();
  });
});

// ===========================================================================
// Where it lives, and in Swedish
// ===========================================================================

describe("the Speakers section in Settings → Transcription", () => {
  beforeEach(() => {
    setMockInvokeHandler("list_whisper_models", () => []);
    setMockInvokeHandler("get_model_metadata", () => {
      throw new Error("offline");
    });
    setMockInvokeHandler("recording_preflight", () => ({
      microphone: "granted",
      system_audio: "available",
      input_device: null,
      output_device: null,
      free_bytes: 1e10,
    }));
  });

  it("is part of the transcription settings page, under its own heading and id", async () => {
    renderWithProviders(<TranscriptionSettings />);
    const section = await screen.findByTestId("speakers-settings");
    expect(section.getAttribute("id")).toBe(SPEAKERS_SETTINGS_SECTION_ID);
    expect(within(section).getByRole("heading", { name: "Speakers", level: 3 })).toBeTruthy();
    expect(within(section).getByRole("heading", { name: "My voice", level: 4 })).toBeTruthy();
    expect(within(section).getByRole("heading", { name: "Known voices", level: 4 })).toBeTruthy();
  });

  it("is scrolled into view when Settings was opened for it", async () => {
    const scrolled = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrolled });
    const opened = vi.fn();
    window.addEventListener("notesage:open-settings", opened);
    try {
      openSpeakerSettings();
      expect(opened).toHaveBeenCalledTimes(1);
      expect((opened.mock.calls[0][0] as CustomEvent).detail).toEqual({ tab: "voice" });
      await mount();
      await waitFor(() => expect(scrolled).toHaveBeenCalled());
      expect(useSpeakersStore.getState().focusSettingsSection).toBe(false);
    } finally {
      window.removeEventListener("notesage:open-settings", opened);
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, writable: true, value: original });
    }
  });

  it("is in Swedish when the app is", async () => {
    install({ profiles: [ANNA] });
    useSpeakersStore.setState({ rememberVoices: true });
    setLocale("sv");
    await mount();
    expect(screen.getByRole("heading", { name: "Talare", level: 3 })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Kom ihåg röster på den här datorn" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch", { name: "Lär in röster från Teams-transkriptioner" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Identifiera talare automatiskt efter transkription" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Min röst", level: 4 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Kända röster", level: 4 })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Spela in min röst" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fler åtgärder för Anna Berg" })).toBeTruthy();
    expect(screen.getByTestId("known-voice").textContent).toContain("2 prov");
    const text = screen.getByTestId("speakers-settings").textContent ?? "";
    for (const english of ["Remember", "voice", "Speakers", "Download", "Delete", "samples"]) {
      expect(text, english).not.toContain(english);
    }
  });
});
