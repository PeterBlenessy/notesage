// @vitest-environment jsdom

/**
 * The parts of speaker identification that sit between the UI and the
 * backend: consent on every voiceprint call, where an analysis result may
 * live, what a Teams merge may teach, and when the automatic run may start.
 */

import "@/test/local-storage";
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mockEmbedding, registerSpeakerHandlers, type SpeakerMockState } from "@/test/tauri-mock";
import type { AnalyzedSpeaker, SpeakerAnalysisResult, VoiceProfileSummary } from "@/lib/tauri";
import { setLocale } from "@/lib/i18n";
import {
  MAX_PREPARED,
  clearAllPreparedAnalyses,
  getPreparedAnalysis,
  preparedAnalysisDirs,
  segmentsFingerprint,
  setPreparedAnalysis,
  type PreparedAnalysis,
} from "@/lib/speakers/analysis-cache";
import { rememberVoices, safeNameChanges, segmentsFromAnalysis } from "@/lib/speakers/apply";
import { shouldAutoIdentify, type FinishedRecording } from "@/lib/speakers/auto-identify";
import { describeSpeakerError, isVoiceModelMissing } from "@/lib/speakers/errors";
import { hasNameSuggestions, isAnalysisCancellation, matchRememberedVoices } from "@/lib/speakers/run-analysis";
import { describeOutcome, learnTeamsVoices, planTeamsLearning } from "@/lib/speakers/teams-learn";
import type { Segment } from "@/lib/transcription/segments";
import { useSpeakersStore } from "@/stores/speakers-store";

let backend: SpeakerMockState;

function speaker(label: string, seed: number, embedding = mockEmbedding(seed)): AnalyzedSpeaker {
  return { label, total_secs: 60, sample: { track_path: "/a.m4a", start: 1, end: 7 }, embedding };
}
function result(speakers: AnalyzedSpeaker[], segments: SpeakerAnalysisResult["segments"] = []): SpeakerAnalysisResult {
  return { turns: [], speakers, segments, duration_secs: 60, model: "wespeaker-voxceleb-resnet34-lm" };
}
function prepared(over: Partial<PreparedAnalysis> = {}): PreparedAnalysis {
  return {
    result: result([speaker("speaker-1", 1)]),
    source: "0:0",
    matches: null,
    participants: [],
    expectedSpeakers: null,
    sharedMicrophone: false,
    at: 1,
    ...over,
  };
}
function stored(id: string, name: string, isMe = false): VoiceProfileSummary {
  return {
    id,
    name,
    is_me: isMe,
    created_at: "2026-11-01T09:00:00Z",
    updated_at: "2026-11-01T09:00:00Z",
    sources: [],
    model: "m",
    exemplar_count: 1,
    usable: true,
  };
}
function consented(): string[] {
  return backend.calls.filter((call) => call.args.consent === true).map((call) => call.cmd);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  clearAllPreparedAnalyses();
  setLocale("en");
  useSpeakersStore.setState(useSpeakersStore.getInitialState(), true);
  backend = registerSpeakerHandlers();
});

// ===========================================================================
// Consent
// ===========================================================================

describe("consent travels with every call that makes or compares a voiceprint", () => {
  it("with the setting off, voices are not compared: the backend is not even asked", async () => {
    const matches = await matchRememberedVoices(result([speaker("speaker-1", 1)]), ["Anna"]);
    expect(matches).toBeNull();
    expect(backend.calls).toEqual([]);
  });

  it("with the setting on, the comparison carries the setting, the participants and the model", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    const matches = await matchRememberedVoices(result([speaker("me", 1), speaker("speaker-1", 2, [])]), ["Anna Berg"]);
    expect(matches).toEqual([{ label: "me", candidates: [] }]);
    expect(backend.argsOf("voice_profiles_match")).toEqual([
      {
        consent: true,
        speakers: [{ label: "me", embedding: mockEmbedding(1) }],
        participants: ["Anna Berg"],
        model: "wespeaker-voxceleb-resnet34-lm",
      },
    ]);
  });

  it("a comparison that fails is “no suggestions”, not an error", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    backend.match = () => {
      throw new Error("This voice embedding was made with another voice model (old). Analyse the recording again.");
    };
    expect(await matchRememberedVoices(result([speaker("speaker-1", 1)]), [])).toEqual([]);
  });

  it("with the setting off, nothing is saved, whatever was ticked", async () => {
    const outcome = await rememberVoices([{ speaker: speaker("speaker-1", 1), name: "Anna" }], {
      bundleDir: "/rec/a",
      model: "m",
      knownProfiles: [],
    });
    expect(outcome).toEqual({ saved: [], failed: [] });
    expect(backend.calls).toEqual([]);
    expect(consented()).toEqual([]);
  });

  it("the backend itself refuses a save without consent, with the contract's exact words", async () => {
    const { tauriApi, VOICE_RECOGNITION_DISABLED } = await import("@/lib/tauri");
    await expect(
      tauriApi.voiceProfileSave({ consent: false, name: "Anna", embedding: mockEmbedding(1), source: { kind: "manual" } }),
    ).rejects.toThrow(VOICE_RECOGNITION_DISABLED);
    await expect(tauriApi.voiceProfilesMatch({ consent: false, speakers: [] })).rejects.toThrow(VOICE_RECOGNITION_DISABLED);
    await expect(tauriApi.enrolOwnVoice(false, "/a.m4a")).rejects.toThrow(VOICE_RECOGNITION_DISABLED);
    expect(backend.profiles).toEqual([]);
  });

  it("skips a voice with no voiceprint or no name, and reports a save the backend refused", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    const outcome = await rememberVoices(
      [
        { speaker: speaker("speaker-1", 1, []), name: "No Voiceprint" },
        { speaker: speaker("speaker-2", 2), name: "   " },
        { speaker: speaker("speaker-3", 3), name: "Anna Berg" },
        { speaker: speaker("speaker-4", 4), name: "x".repeat(3) },
      ],
      { bundleDir: "/rec/a", model: "m", knownProfiles: [] },
    );
    expect(backend.argsOf("voice_profile_save").map((a) => a.name)).toEqual(["Anna Berg", "xxx"]);
    expect(outcome.saved.map((p) => p.name)).toEqual(["Anna Berg", "xxx"]);
    expect(outcome.failed).toEqual([]);

    backend.profiles = [];
    const { setMockInvokeHandler } = await import("@/test/tauri-mock");
    setMockInvokeHandler("voice_profile_save", () => {
      throw new Error("The name is too long (at most 120 characters)");
    });
    const failed = await rememberVoices([{ speaker: speaker("speaker-1", 1), name: "Anna" }], {
      bundleDir: "/rec/a",
      model: "m",
      knownProfiles: [],
    });
    expect(failed).toEqual({ saved: [], failed: [{ name: "Anna", error: "The name is too long (at most 120 characters)" }] });
  });

  it("sends a profile id only while the confirmed name is still that stored voice's name", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    const known = [stored("vp-anna", "Anna Berg"), stored("vp-erik", "Erik Lund")];
    backend.profiles = known.map((p) => ({ ...p, sources: [] }));
    await rememberVoices(
      [
        { speaker: speaker("speaker-1", 1), name: "anna  berg", profileId: "vp-anna" },
        { speaker: speaker("speaker-2", 2), name: "Somebody Else", profileId: "vp-erik" },
        { speaker: speaker("speaker-3", 3), name: "Erik Lund", profileId: "vp-gone" },
      ],
      { bundleDir: "/rec/a", model: "m", knownProfiles: known },
    );
    expect(backend.argsOf("voice_profile_save").map((a) => [a.name, a.profileId])).toEqual([
      ["anna berg", "vp-anna"],
      ["Somebody Else", null],
      ["Erik Lund", null],
    ]);
  });

  it("“Me” goes to the user's own profile, under the name it has, or the typed one", async () => {
    useSpeakersStore.setState({ rememberVoices: true });
    const known = [stored("vp-me", "Peter", true)];
    backend.profiles = known.map((p) => ({ ...p, sources: [] }));
    await rememberVoices([{ speaker: speaker("me", 1), name: "" }], { bundleDir: "/r", model: "m", knownProfiles: known });
    await rememberVoices([{ speaker: speaker("me", 1), name: "Peter H" }], { bundleDir: "/r", model: "m", knownProfiles: known });
    expect(backend.argsOf("voice_profile_save").map((a) => [a.name, a.isMe, a.profileId])).toEqual([
      ["Peter", true, null],
      ["Peter H", true, null],
    ]);
    // With no profile yet, the default name is the translated "Me".
    backend.profiles = [];
    await rememberVoices([{ speaker: speaker("me", 1), name: "" }], { bundleDir: "/r", model: "m", knownProfiles: [] });
    expect(backend.argsOf("voice_profile_save")[2].name).toBe("Me");
  });
});

// ===========================================================================
// Where an analysis result may live
// ===========================================================================

describe("analysis results (with their voiceprints) are held in memory only", () => {
  it("the cache is a plain module map, bounded, oldest out first", () => {
    for (let i = 0; i < MAX_PREPARED + 3; i++) setPreparedAnalysis(`/rec/${i}`, prepared({ at: i }));
    expect(preparedAnalysisDirs()).toHaveLength(MAX_PREPARED);
    expect(getPreparedAnalysis("/rec/0")).toBeUndefined();
    expect(getPreparedAnalysis(`/rec/${MAX_PREPARED + 2}`)?.at).toBe(MAX_PREPARED + 2);
    // Setting one again makes it the newest.
    setPreparedAnalysis("/rec/3", prepared({ at: 99 }));
    setPreparedAnalysis("/rec/new", prepared());
    expect(getPreparedAnalysis("/rec/3")?.at).toBe(99);
  });

  it("the store keeps a summary only, and its saved form is three booleans", () => {
    setPreparedAnalysis("/rec/a", prepared());
    useSpeakersStore.getState().setPrepared("/rec/a", { voices: 1, hasSuggestions: false });
    useSpeakersStore.getState().setJob("/rec/b", { jobId: "j", phase: "running", stage: "analyzing", percent: 5, automatic: false });
    useSpeakersStore.setState({ rememberVoices: true });

    const state = JSON.stringify(useSpeakersStore.getState());
    expect(state).not.toContain("embedding");
    expect(state).not.toContain(String(mockEmbedding(1)[0]));
    const saved = JSON.parse(localStorage.getItem("notesage-speakers") ?? "{}") as { state: Record<string, unknown> };
    expect(saved.state).toEqual({ rememberVoices: true, learnFromTeams: false, autoIdentify: false });
    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i) ?? "") ?? "").not.toContain("embedding");
    }
  });

  it("clearing a summary drops the result; deleting all voices drops every result", async () => {
    setPreparedAnalysis("/rec/a", prepared());
    setPreparedAnalysis("/rec/b", prepared());
    useSpeakersStore.getState().setPrepared("/rec/a", { voices: 1, hasSuggestions: true });
    useSpeakersStore.getState().setPrepared("/rec/b", { voices: 1, hasSuggestions: true });

    useSpeakersStore.getState().setPrepared("/rec/a", null);
    expect(getPreparedAnalysis("/rec/a")).toBeUndefined();
    expect(getPreparedAnalysis("/rec/b")).toBeDefined();

    await useSpeakersStore.getState().deleteAllProfiles();
    expect(preparedAnalysisDirs()).toEqual([]);
    expect(useSpeakersStore.getState().prepared).toEqual({});
  });

  it("the segments taken from an analysis carry text, times and a label, and nothing else", () => {
    const segments = segmentsFromAnalysis([
      { start: 0, end: 2, text: "Hi", speaker: " speaker-1 " },
      { start: 2, end: 4, text: "Yes", speaker: null },
      { start: 4, end: 6, text: "No" },
    ]);
    expect(segments).toEqual([
      { start: 0, end: 2, text: "Hi", speaker: "speaker-1" },
      { start: 2, end: 4, text: "Yes" },
      { start: 4, end: 6, text: "No" },
    ]);
  });

  it("fingerprints a transcript so a result made for another transcription can be told apart", () => {
    const a = [
      { start: 0, end: 4.5, text: "Hello there. How are you?" },
      { start: 5, end: 9, text: " Fine,  thanks. " },
    ];
    // Stable, and blind to whitespace and to who is labelled as speaking.
    expect(segmentsFingerprint(a)).toBe(segmentsFingerprint(a.map((s) => ({ ...s }))));
    expect(segmentsFingerprint(a)).toBe(
      segmentsFingerprint([
        { start: 0, end: 4.5, text: "Hello there.  How are you? ", speaker: "me" },
        { start: 5, end: 9, text: "Fine, thanks." },
      ] as typeof a),
    );
    // Different words, different timings, a different number of segments: all different.
    expect(segmentsFingerprint(a)).not.toBe(segmentsFingerprint([a[0], { ...a[1], text: "Fine, thank you." }]));
    expect(segmentsFingerprint(a)).not.toBe(segmentsFingerprint([a[0], { ...a[1], start: 5.5 }]));
    expect(segmentsFingerprint(a)).not.toBe(segmentsFingerprint([a[0]]));
    expect(segmentsFingerprint([])).toBe(segmentsFingerprint([]));
    // It says nothing about what was said.
    expect(segmentsFingerprint(a)).toMatch(/^2:[0-9a-f]{1,8}$/);
  });

  it("knows when a result offers a name for somebody", () => {
    expect(hasNameSuggestions(prepared())).toBe(false);
    expect(hasNameSuggestions(prepared({ participants: ["Anna"] }))).toBe(true);
    expect(
      hasNameSuggestions(
        prepared({ result: result([speaker("speaker-1", 1)], [{ start: 0, end: 2, text: "My name is Anna.", speaker: "speaker-1" }]) }),
      ),
    ).toBe(true);
    expect(hasNameSuggestions(prepared({ matches: [{ label: "speaker-1", candidates: [] }] }))).toBe(false);
    expect(
      hasNameSuggestions(
        prepared({
          matches: [
            {
              label: "speaker-1",
              candidates: [{ profile_id: "p", name: "Anna", is_me: false, score: 0.6, confidence: "likely", participant: false }],
            },
          ],
        }),
      ),
    ).toBe(true);
  });
});

// ===========================================================================
// Safe name changes in an edited transcript
// ===========================================================================

describe("safeNameChanges", () => {
  it("renames an old label only for a voice matched to it, and only when the shown name changes", () => {
    const safe = safeNameChanges(
      { "speaker-2": "speaker-1", "speaker-1": "speaker-2", me: "me" },
      { "speaker-1": "Anna Berg" },
      { "speaker-2": "Anna Lindqvist", "speaker-1": "Erik Lund" },
    );
    expect(safe.names).toEqual({ "speaker-1": "Anna Lindqvist", "speaker-2": "Erik Lund" });
    expect(safe.changes).toEqual([
      { from: "Anna Berg", to: "Anna Lindqvist" },
      { from: "Speaker 2", to: "Erik Lund" },
    ]);
  });

  it("has nothing to do when no matched voice got a different name", () => {
    expect(safeNameChanges({ "speaker-1": "speaker-1" }, { "speaker-1": "Anna" }, { "speaker-1": "Anna" }).changes).toEqual([]);
    expect(safeNameChanges({ "speaker-1": "speaker-1" }, {}, {}).changes).toEqual([]);
    // An unmatched voice is not a change that text replacement can make.
    expect(safeNameChanges({}, {}, { "speaker-1": "Anna" }).changes).toEqual([]);
  });
});

// ===========================================================================
// Learning from Teams
// ===========================================================================

describe("planTeamsLearning", () => {
  const MERGED: Segment[] = [
    { start: 0, end: 10, text: "Welcome.", speaker: "Peter Holm" },
    { start: 11, end: 20, text: "Thanks.", speaker: "Anna Berg" },
    { start: 21, end: 30, text: "Hello.", speaker: "Erik Lund" },
    { start: 31, end: 40, text: "Let us begin.", speaker: "Peter Holm" },
    { start: 41, end: 41, text: "", speaker: "Anna Berg" },
    { start: 42, end: 44, text: "Hm." },
  ];

  it("for a single-track recording, learns everyone Teams named, from the recording's audio", () => {
    const plan = planTeamsLearning(MERGED, {}, { audioPath: "/rec/a/audio.m4a", tracks: null, previousSegments: [] });
    expect(plan?.audioPath).toBe("/rec/a/audio.m4a");
    expect(plan?.names).toEqual(["Peter Holm", "Anna Berg", "Erik Lund"]);
    expect(plan?.ownName).toBeNull();
    // Zero-length and unlabelled stretches are not turns.
    expect(plan?.turns).toEqual([
      { start: 0, end: 10, speaker: "Peter Holm" },
      { start: 11, end: 20, speaker: "Anna Berg" },
      { start: 21, end: 30, speaker: "Erik Lund" },
      { start: 31, end: 40, speaker: "Peter Holm" },
    ]);
  });

  it("for a two-track recording, uses the system track and leaves out the user (whose turns were the microphone's)", () => {
    const previous: Segment[] = [
      { start: 0, end: 10, text: "Welcome.", speaker: "me" },
      { start: 11, end: 30, text: "Thanks. Hello.", speaker: "others" },
      { start: 31, end: 40, text: "Let us begin.", speaker: "me" },
    ];
    const plan = planTeamsLearning(
      MERGED,
      {},
      {
        audioPath: "/rec/a/audio.m4a",
        tracks: [
          { role: "mic", path: "/rec/a/mic.m4a" },
          { role: "system", path: "/rec/a/system.m4a" },
        ],
        previousSegments: previous,
      },
    );
    expect(plan?.audioPath).toBe("/rec/a/system.m4a");
    expect(plan?.ownName).toBe("Peter Holm");
    expect(plan?.names).toEqual(["Anna Berg", "Erik Lund"]);
    expect(plan?.turns.every((turn) => turn.speaker !== "Peter Holm")).toBe(true);
  });

  it("uses the name the user gave a Teams label, and never learns a generic label", () => {
    const plan = planTeamsLearning(
      [
        { start: 0, end: 10, text: "a", speaker: "Berg, Anna (Contoso)" },
        { start: 11, end: 20, text: "b", speaker: "others" },
        { start: 21, end: 30, text: "c", speaker: "speaker-2" },
      ],
      { "Berg, Anna (Contoso)": "Anna Berg" },
      { audioPath: "/a.m4a", tracks: null, previousSegments: [] },
    );
    expect(plan?.names).toEqual(["Anna Berg"]);
    expect(plan?.turns).toEqual([{ start: 0, end: 10, speaker: "Anna Berg" }]);
  });

  it("has nothing to offer without audio, or without anybody named", () => {
    expect(planTeamsLearning(MERGED, {}, { audioPath: null, tracks: null, previousSegments: [] })).toBeNull();
    expect(
      planTeamsLearning([{ start: 0, end: 5, text: "a", speaker: "me" }], {}, { audioPath: "/a", tracks: null, previousSegments: [] }),
    ).toBeNull();
  });

  it("learning refuses to run unless both opt-ins are on at that moment", async () => {
    const plan = planTeamsLearning(MERGED, {}, { audioPath: "/a.m4a", tracks: null, previousSegments: [] })!;
    for (const settings of [
      { rememberVoices: false, learnFromTeams: false },
      { rememberVoices: true, learnFromTeams: false },
    ]) {
      useSpeakersStore.setState(settings);
      expect(await learnTeamsVoices(plan, "/rec/a")).toEqual({ saved: [], skipped: [], failed: [] });
    }
    expect(backend.calls).toEqual([]);

    useSpeakersStore.setState({ rememberVoices: true, learnFromTeams: true });
    const outcome = await learnTeamsVoices(plan, "/rec/a");
    expect(outcome.saved).toEqual(["Peter Holm", "Anna Berg", "Erik Lund"]);
    expect(backend.argsOf("voice_profile_save").every((a) => a.consent === true)).toBe(true);
    expect(backend.profiles.map((p) => p.sources[0].kind)).toEqual(["teams", "teams", "teams"]);
  });

  it("describes what happened in plain sentences", () => {
    expect(describeOutcome({ saved: ["Anna"], skipped: [], failed: [] })).toBe("Remembered 1 voice: Anna.");
    expect(
      describeOutcome({
        saved: ["Anna", "Erik"],
        skipped: [{ name: "Sara", reason: "Too little clean speech: 2 s" }],
        failed: [{ name: "Olle", error: "disk full" }],
      }),
    ).toBe("Remembered 2 voices: Anna, Erik. Skipped 1: Sara (too little clear speech). Could not save Olle: disk full.");
    expect(describeOutcome({ saved: [], skipped: [], failed: [] })).toBe("No voices could be learnt from this recording.");
  });
});

// ===========================================================================
// The automatic run, and errors
// ===========================================================================

describe("shouldAutoIdentify", () => {
  const bundle: FinishedRecording = {
    dir: "/rec/a",
    audioPath: "/rec/a/audio.m4a",
    transcriptPath: "/rec/a/Meeting.md",
    hasTeamsTranscript: false,
    tracks: null,
  };

  it("is false unless the setting is on", () => {
    expect(shouldAutoIdentify(bundle)).toBe(false);
    useSpeakersStore.setState({ autoIdentify: true });
    expect(shouldAutoIdentify(bundle)).toBe(true);
  });

  it("leaves alone a recording Teams already names, one without a transcript, one being analysed, and one already prepared", () => {
    useSpeakersStore.setState({ autoIdentify: true });
    expect(shouldAutoIdentify({ ...bundle, hasTeamsTranscript: true })).toBe(false);
    expect(shouldAutoIdentify({ ...bundle, transcriptPath: null })).toBe(false);
    expect(shouldAutoIdentify({ ...bundle, audioPath: null })).toBe(false);
    useSpeakersStore.getState().setJob("/rec/a", { jobId: "j", phase: "starting", stage: null, percent: 0, automatic: true });
    expect(shouldAutoIdentify(bundle)).toBe(false);
    useSpeakersStore.getState().setJob("/rec/a", null);
    useSpeakersStore.getState().setPrepared("/rec/a", { voices: 2, hasSuggestions: true });
    expect(shouldAutoIdentify(bundle)).toBe(false);
  });
});

describe("backend errors in the app's words", () => {
  it.each([
    ["Voice models are not downloaded. Download them from Settings > Transcription.", "The voice model is not downloaded. Download it in Settings → Transcription → Speakers."],
    ["Voice recognition is not enabled", "Remembering voices is turned off. Turn it on in Settings → Transcription → Speakers."],
    [
      "Not enough speech to learn the voice: found 3.2 s of speech, need at least 8 s",
      "Not enough speech to learn the voice: found 3.2 s, and at least 8 s is needed. Speak for a little longer.",
    ],
    ["The voice models are in use by a running analysis. Try again when it finishes.", "The voice model is in use by a running analysis. Try again when it has finished."],
    ["Voice models are already being downloaded", "The voice model is already being downloaded."],
    [
      "This voice embedding was made with another voice model (old-model). Analyse the recording again.",
      "This analysis was made with another voice model. Analyse the recording again.",
    ],
    ["A voice profile needs a name", "A voice needs a name."],
    ["Audio file not found: /x/audio.m4a", "The audio file is missing."],
    ["Error: Something nobody anticipated", "Something nobody anticipated"],
  ])("%s", (raw, shown) => {
    expect(describeSpeakerError(raw)).toBe(shown);
    expect(describeSpeakerError(new Error(raw.replace(/^Error: /, "")))).toBe(shown);
  });

  it("is in Swedish when the app is", () => {
    setLocale("sv");
    expect(describeSpeakerError("Voice recognition is not enabled")).toBe(
      "Att komma ihåg röster är avstängt. Slå på det i Inställningar → Transkribering → Talare.",
    );
    setLocale("en");
  });

  it("recognises the missing-model and the cancel errors", () => {
    expect(isVoiceModelMissing("Voice models are not downloaded. Download them from Settings > Transcription.")).toBe(true);
    expect(isVoiceModelMissing("Model 'small' not downloaded")).toBe(false);
    expect(isAnalysisCancellation(new Error("Speaker analysis cancelled"))).toBe(true);
    expect(isAnalysisCancellation("Transcription cancelled")).toBe(false);
  });
});
