import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RECORDING_MANIFEST,
  createMacRecordingManifest,
  isPendingTranscription,
  isoWithOffset,
  parseRecordingManifest,
  parseTranscriptionStatus,
  serializeRecordingManifest,
  withTranscriptionStatus,
  type RecordingManifest,
} from "@/lib/transcription/manifest";

// The fixture the Swift `RecordingManifest: Codable` test decodes too — the
// one artefact both sides must agree on byte for byte.
const FIXTURE = readFileSync(
  join(__dirname, "../../../../tests/fixtures/recording-manifest.v1.json"),
  "utf8",
);

function fixture(): Record<string, unknown> {
  return JSON.parse(FIXTURE) as Record<string, unknown>;
}

function withPatch(patch: (raw: Record<string, unknown>) => void): string {
  const raw = fixture();
  patch(raw);
  return JSON.stringify(raw);
}

describe("recording.json contract", () => {
  it("names the manifest file", () => {
    expect(RECORDING_MANIFEST).toBe("recording.json");
  });

  it("parses the shared fixture with every field the PRD lists", () => {
    const m = parseRecordingManifest(FIXTURE);
    expect(m).not.toBeNull();
    expect(m!.version).toBe(1);
    expect(m!.createdBy).toEqual({ device: "Peter's iPhone", app: "notesage-ios", appVersion: "0.57.0" });
    expect(m!.startedAt).toBe("2026-09-05T14:02:11+02:00");
    expect(m!.durationSecs).toBe(1834.2);
    expect(m!.source).toBe("microphone");
    expect(m!.language).toBe("sv");
    expect(m!.audio).toEqual({
      file: "audio.m4a",
      bytes: 14703112,
      codec: "aac",
      sampleRate: 48000,
      channels: 1,
      bitrate: 64000,
    });
    expect(m!.transcription).toBeNull();
  });

  it("round-trips the fixture byte for byte (stable key order, 2-space indent, trailing newline)", () => {
    const m = parseRecordingManifest(FIXTURE)!;
    expect(serializeRecordingManifest(m)).toBe(FIXTURE);
  });

  it("serializes in contract order regardless of the order the input had", () => {
    const shuffled = JSON.stringify({
      transcription: null,
      audio: { bitrate: 64000, channels: 1, sampleRate: 48000, codec: "aac", bytes: 14703112, file: "audio.m4a" },
      language: "sv",
      source: "microphone",
      durationSecs: 1834.2,
      startedAt: "2026-09-05T14:02:11+02:00",
      createdBy: { appVersion: "0.57.0", app: "notesage-ios", device: "Peter's iPhone" },
      version: 1,
    });
    expect(serializeRecordingManifest(parseRecordingManifest(shuffled)!)).toBe(FIXTURE);
  });

  it("preserves unknown fields on rewrite — top level and nested — after the known ones", () => {
    const json = withPatch((raw) => {
      raw.phoneOnly = { foo: 1 };
      (raw.audio as Record<string, unknown>).peakLevel = 0.7;
      (raw.createdBy as Record<string, unknown>).os = "iOS 26";
    });
    const m = parseRecordingManifest(json)!;
    const out = serializeRecordingManifest(m);
    const back = JSON.parse(out) as Record<string, unknown>;
    expect(back.phoneOnly).toEqual({ foo: 1 });
    expect((back.audio as Record<string, unknown>).peakLevel).toBe(0.7);
    expect((back.createdBy as Record<string, unknown>).os).toBe("iOS 26");
    expect(Object.keys(back)).toEqual([
      "version", "createdBy", "startedAt", "durationSecs", "source", "language", "audio", "transcription", "phoneOnly",
    ]);
    // And the Mac's rewrite keeps them too.
    const claimed = withTranscriptionStatus(m, { status: "running", device: "Peter's Mac", updatedAt: "2026-09-05T14:40:00+02:00" });
    const claimedBack = JSON.parse(serializeRecordingManifest(claimed)) as Record<string, unknown>;
    expect(claimedBack.phoneOnly).toEqual({ foo: 1 });
    expect(Object.keys(claimedBack.transcription as Record<string, unknown>)).toEqual(["status", "device", "updatedAt"]);
  });

  it("omits an absent language rather than writing null", () => {
    const m = parseRecordingManifest(withPatch((raw) => { delete raw.language; }))!;
    expect(m.language).toBeUndefined();
    expect(serializeRecordingManifest(m)).not.toContain("language");
  });

  it("parses a Mac-annotated transcription block in every state", () => {
    for (const status of ["running", "done", "failed"] as const) {
      const m = parseRecordingManifest(withPatch((raw) => {
        raw.transcription = {
          status, device: "Peter's Mac", updatedAt: "2026-09-05T14:40:00+02:00",
          model: "large-v3-turbo-q5_0", engine: "whisper", language: "sv", error: status === "failed" ? "boom" : undefined,
        };
      }));
      expect(m?.transcription?.status).toBe(status);
      expect(m?.transcription?.device).toBe("Peter's Mac");
    }
  });

  describe("rejections (→ null)", () => {
    const cases: Array<[string, string]> = [
      ["invalid JSON", "{not json"],
      ["a JSON array", "[]"],
      ["a JSON scalar", '"hi"'],
      ["a future version", withPatch((r) => { r.version = 2; })],
      ["a missing version", withPatch((r) => { delete r.version; })],
      ["a string version", withPatch((r) => { r.version = "1"; })],
      ["no createdBy", withPatch((r) => { delete r.createdBy; })],
      ["an empty device", withPatch((r) => { (r.createdBy as Record<string, unknown>).device = ""; })],
      ["an unknown app", withPatch((r) => { (r.createdBy as Record<string, unknown>).app = "notesage-android"; })],
      ["a non-string appVersion", withPatch((r) => { (r.createdBy as Record<string, unknown>).appVersion = 57; })],
      ["no startedAt", withPatch((r) => { delete r.startedAt; })],
      ["a numeric startedAt", withPatch((r) => { r.startedAt = 1757073731; })],
      ["a negative duration", withPatch((r) => { r.durationSecs = -1; })],
      ["a string duration", withPatch((r) => { r.durationSecs = "1834.2"; })],
      ["an unknown source", withPatch((r) => { r.source = "system"; })],
      ["a non-string language", withPatch((r) => { r.language = 42; })],
      ["an empty language", withPatch((r) => { r.language = ""; })],
      ["no audio", withPatch((r) => { delete r.audio; })],
      ["an empty audio file name", withPatch((r) => { (r.audio as Record<string, unknown>).file = ""; })],
      ["fractional bytes", withPatch((r) => { (r.audio as Record<string, unknown>).bytes = 1.5; })],
      ["negative bytes", withPatch((r) => { (r.audio as Record<string, unknown>).bytes = -1; })],
      ["an unknown codec", withPatch((r) => { (r.audio as Record<string, unknown>).codec = "opus"; })],
      ["a zero sample rate", withPatch((r) => { (r.audio as Record<string, unknown>).sampleRate = 0; })],
      ["zero channels", withPatch((r) => { (r.audio as Record<string, unknown>).channels = 0; })],
      ["a string bitrate", withPatch((r) => { (r.audio as Record<string, unknown>).bitrate = "64k"; })],
      ["a missing transcription key", withPatch((r) => { delete r.transcription; })],
      ["a transcription with an unknown status", withPatch((r) => { r.transcription = { status: "queued", device: "Mac", updatedAt: "x" }; })],
      ["a transcription without a device", withPatch((r) => { r.transcription = { status: "running", updatedAt: "x" }; })],
      ["a transcription without updatedAt", withPatch((r) => { r.transcription = { status: "running", device: "Mac" }; })],
      ["a transcription with an unknown engine", withPatch((r) => { r.transcription = { status: "done", device: "Mac", updatedAt: "x", engine: "deepgram" }; })],
      ["a transcription with a non-string error", withPatch((r) => { r.transcription = { status: "failed", device: "Mac", updatedAt: "x", error: 500 }; })],
      ["a transcription that is a string", withPatch((r) => { r.transcription = "done"; })],
    ];
    for (const [label, json] of cases) {
      it(`rejects ${label}`, () => {
        expect(parseRecordingManifest(json)).toBeNull();
      });
    }
  });

  it("parseTranscriptionStatus distinguishes null (untouched) from undefined (invalid)", () => {
    expect(parseTranscriptionStatus(null)).toBeNull();
    expect(parseTranscriptionStatus({ status: "nope" })).toBeUndefined();
    expect(parseTranscriptionStatus({ status: "done", device: "Mac", updatedAt: "x" })).toEqual({
      status: "done", device: "Mac", updatedAt: "x",
    });
  });
});

describe("isPendingTranscription", () => {
  const m = parseRecordingManifest(FIXTURE)!;
  const at = (status: "running" | "done" | "failed") =>
    withTranscriptionStatus(m, { status, device: "Peter's Mac", updatedAt: "2026-09-05T14:40:00+02:00" });

  it("is pending when the manifest exists and the transcript does not", () => {
    expect(isPendingTranscription(m, false)).toBe(true);
  });
  it("is never pending once transcript.md exists", () => {
    expect(isPendingTranscription(m, true)).toBe(false);
    expect(isPendingTranscription(at("running"), true)).toBe(false);
  });
  it("is not pending once a device recorded the job as done", () => {
    expect(isPendingTranscription(at("done"), false)).toBe(false);
  });
  it("leaves running / failed to the scanner's device- and time-aware rules", () => {
    expect(isPendingTranscription(at("running"), false)).toBe(true);
    expect(isPendingTranscription(at("failed"), false)).toBe(true);
  });
});

describe("withTranscriptionStatus", () => {
  it("returns a new manifest and leaves the input alone", () => {
    const m = parseRecordingManifest(FIXTURE)!;
    const next = withTranscriptionStatus(m, { status: "running", device: "Mac", updatedAt: "x" });
    expect(next).not.toBe(m);
    expect(m.transcription).toBeNull();
    expect(next.transcription?.status).toBe("running");
    expect(withTranscriptionStatus(next, null).transcription).toBeNull();
  });
});

describe("isoWithOffset", () => {
  const ms = Date.parse("2026-09-05T12:02:11Z");
  it("writes the wall clock with the given UTC offset", () => {
    expect(isoWithOffset(ms, -120)).toBe("2026-09-05T14:02:11+02:00");
    expect(isoWithOffset(ms, 300)).toBe("2026-09-05T07:02:11-05:00");
    expect(isoWithOffset(ms, -330)).toBe("2026-09-05T17:32:11+05:30");
  });
  it("uses +00:00 at UTC, never Z", () => {
    expect(isoWithOffset(ms, 0)).toBe("2026-09-05T12:02:11+00:00");
  });
  it("parses back to the same instant", () => {
    expect(Date.parse(isoWithOffset(ms, -120))).toBe(ms);
    expect(Date.parse(isoWithOffset(ms))).toBe(ms);
  });
});

describe("createMacRecordingManifest", () => {
  it("describes a Mac WAV bundle: notesage-macos, pcm, mono, no bitrate", () => {
    const m = createMacRecordingManifest({
      startedAtMs: Date.parse("2026-09-05T12:02:11Z"),
      durationSecs: 12.5,
      bytes: 400_044,
      sampleRate: 16000,
      audioFile: "audio.wav",
      device: "Peter's Mac",
      appVersion: "0.57.0",
      language: "sv",
    });
    expect(m.createdBy).toEqual({ device: "Peter's Mac", app: "notesage-macos", appVersion: "0.57.0" });
    expect(m.audio).toEqual({ file: "audio.wav", bytes: 400_044, codec: "pcm", sampleRate: 16000, channels: 1 });
    expect(m.language).toBe("sv");
    expect(m.transcription).toBeNull();
    expect(Date.parse(m.startedAt)).toBe(Date.parse("2026-09-05T12:02:11Z"));
    // It is a valid manifest by its own parser.
    const back: RecordingManifest | null = parseRecordingManifest(serializeRecordingManifest(m));
    expect(back).toEqual(m);
  });

  it("omits the language when it is auto-detect or absent", () => {
    const base = { startedAtMs: 0, durationSecs: 1, bytes: 1, sampleRate: 16000, audioFile: "audio.wav", device: "Mac", appVersion: "" };
    expect(createMacRecordingManifest({ ...base, language: "auto" }).language).toBeUndefined();
    expect(createMacRecordingManifest(base).language).toBeUndefined();
  });
});
