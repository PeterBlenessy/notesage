/**
 * `recording.json` — the contract between a recording bundle's producer and
 * the Mac that transcribes it (PRD `2026-09-05-ios-recordings.md`, § Data
 * Model). Written by the phone at finalize (and by the Mac for its own
 * bundles), annotated by the Mac with its transcription state.
 *
 * Shared by desktop and phone; the Swift `RecordingManifest: Codable` mirror
 * decodes the same fixture (`tests/fixtures/recording-manifest.v1.json`) so
 * the two cannot drift.
 *
 * **Key order is part of the contract.** `serializeRecordingManifest` emits
 * the keys in the order the PRD example lists them (two-space pretty print,
 * trailing newline), so a round-trip through either side is byte-stable and a
 * `git diff` of a manifest shows the one field that changed. Unknown fields
 * are preserved on rewrite — the phone and the Mac each own their half, and
 * neither may drop what the other wrote.
 */

export const RECORDING_MANIFEST = "recording.json";
export const RECORDING_MANIFEST_VERSION = 1 as const;

export type RecordingManifestApp = "notesage-ios" | "notesage-macos";
export type RecordingAudioCodec = "aac" | "pcm";
export type TranscriptionState = "running" | "done" | "failed";
export type TranscriptionEngine = "whisper" | "apple-speech";

export interface RecordingManifestCreator {
  /** The device label the Inbox reading-progress sidecar uses (`"Peter's iPhone"`). */
  device: string;
  app: RecordingManifestApp;
  appVersion: string;
}

export interface RecordingManifestAudio {
  /** Filename inside the bundle (`audio.m4a` on the phone, `audio.wav` on the Mac). */
  file: string;
  /** Exact on-disk size at finalize — the Mac's partial-download gate. */
  bytes: number;
  codec: RecordingAudioCodec;
  sampleRate: number;
  channels: number;
  bitrate?: number;
}

export interface TranscriptionStatus {
  status: TranscriptionState;
  /** The device that claimed / finished the job. */
  device: string;
  /** ISO-8601 of the last status change on that device. */
  updatedAt: string;
  model?: string;
  /** Phase 4 — on-device transcription. */
  engine?: TranscriptionEngine;
  language?: string;
  error?: string;
}

export interface RecordingManifest {
  version: typeof RECORDING_MANIFEST_VERSION;
  createdBy: RecordingManifestCreator;
  /** ISO-8601 with offset. */
  startedAt: string;
  /** Pause-aware recorded length. */
  durationSecs: number;
  source: "microphone";
  /** One of the `SPEECH_LANGUAGES` codes; omitted when the phone's language is not one the Mac knows. */
  language?: string;
  audio: RecordingManifestAudio;
  transcription: TranscriptionStatus | null;
}

const TOP_KEYS = [
  "version",
  "createdBy",
  "startedAt",
  "durationSecs",
  "source",
  "language",
  "audio",
  "transcription",
] as const;
const CREATED_BY_KEYS = ["device", "app", "appVersion"] as const;
const AUDIO_KEYS = ["file", "bytes", "codec", "sampleRate", "channels", "bitrate"] as const;
const TRANSCRIPTION_KEYS = [
  "status",
  "device",
  "updatedAt",
  "model",
  "engine",
  "language",
  "error",
] as const;

const APPS: readonly string[] = ["notesage-ios", "notesage-macos"];
const CODECS: readonly string[] = ["aac", "pcm"];
const STATES: readonly string[] = ["running", "done", "failed"];
const ENGINES: readonly string[] = ["whisper", "apple-speech"];

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}
function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isOptionalString(v: unknown): v is string | undefined {
  return v === undefined || typeof v === "string";
}

function parseCreator(v: unknown): RecordingManifestCreator | null {
  if (!isRecord(v)) return null;
  if (!isNonEmptyString(v.device)) return null;
  if (typeof v.app !== "string" || !APPS.includes(v.app)) return null;
  if (typeof v.appVersion !== "string") return null;
  return v as unknown as RecordingManifestCreator;
}

function parseAudio(v: unknown): RecordingManifestAudio | null {
  if (!isRecord(v)) return null;
  if (!isNonEmptyString(v.file)) return null;
  if (!isFiniteNumber(v.bytes) || v.bytes < 0 || !Number.isInteger(v.bytes)) return null;
  if (typeof v.codec !== "string" || !CODECS.includes(v.codec)) return null;
  if (!isFiniteNumber(v.sampleRate) || v.sampleRate <= 0) return null;
  if (!isFiniteNumber(v.channels) || v.channels <= 0 || !Number.isInteger(v.channels)) return null;
  if (v.bitrate !== undefined && !isFiniteNumber(v.bitrate)) return null;
  return v as unknown as RecordingManifestAudio;
}

/**
 * The Mac-owned half. `null` means "nobody has touched it"; anything else
 * must name a state and the device that set it.
 */
export function parseTranscriptionStatus(v: unknown): TranscriptionStatus | null | undefined {
  if (v === null) return null;
  if (!isRecord(v)) return undefined;
  if (typeof v.status !== "string" || !STATES.includes(v.status)) return undefined;
  if (!isNonEmptyString(v.device)) return undefined;
  if (!isNonEmptyString(v.updatedAt)) return undefined;
  if (!isOptionalString(v.model) || !isOptionalString(v.language) || !isOptionalString(v.error)) {
    return undefined;
  }
  if (v.engine !== undefined && (typeof v.engine !== "string" || !ENGINES.includes(v.engine))) {
    return undefined;
  }
  return v as unknown as TranscriptionStatus;
}

/**
 * Parse a manifest. Tolerant of fields it does not know (they ride along and
 * come back out of `serializeRecordingManifest`), strict about the ones it
 * does: a wrong `version`, a missing required field or a value of the wrong
 * shape returns `null` — the scanner then leaves the bundle alone rather than
 * guessing at what a future format meant.
 */
export function parseRecordingManifest(json: string): RecordingManifest | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (raw.version !== RECORDING_MANIFEST_VERSION) return null;
  if (!parseCreator(raw.createdBy)) return null;
  if (!isNonEmptyString(raw.startedAt)) return null;
  if (!isFiniteNumber(raw.durationSecs) || raw.durationSecs < 0) return null;
  if (raw.source !== "microphone") return null;
  if (raw.language !== undefined && !isNonEmptyString(raw.language)) return null;
  if (!parseAudio(raw.audio)) return null;
  if (!("transcription" in raw)) return null;
  if (parseTranscriptionStatus(raw.transcription) === undefined) return null;
  return raw as unknown as RecordingManifest;
}

/** Known keys first, in contract order; anything else after, in its own order. */
function ordered(obj: Rec, known: readonly string[]): Rec {
  const out: Rec = {};
  for (const key of known) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  for (const key of Object.keys(obj)) {
    if (!(key in out) && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/**
 * Serialize with the contract's key order, two-space indent and a trailing
 * newline. `serialize(parse(fixture)) === fixture` — the vitest and the Swift
 * test both assert it against the shared fixture.
 */
export function serializeRecordingManifest(manifest: RecordingManifest): string {
  const m = manifest as unknown as Rec;
  const top = ordered(m, TOP_KEYS);
  top.createdBy = ordered(m.createdBy as Rec, CREATED_BY_KEYS);
  top.audio = ordered(m.audio as Rec, AUDIO_KEYS);
  top.transcription = isRecord(m.transcription)
    ? ordered(m.transcription, TRANSCRIPTION_KEYS)
    : null;
  return `${JSON.stringify(top, null, 2)}\n`;
}

/**
 * The pending rule: a bundle with a manifest and no `transcript.md` wants
 * transcribing, unless a device has already recorded the job as `done`. The
 * time- and device-aware refinements (a `running` claim by another device,
 * `failed` not being retried blindly) belong to the scanner, which has the
 * clock and knows its own name — see `evaluateBundle`.
 */
export function isPendingTranscription(
  manifest: RecordingManifest,
  transcriptExists: boolean,
): boolean {
  if (transcriptExists) return false;
  return manifest.transcription?.status !== "done";
}

/** A copy of the manifest with the Mac-owned half replaced. Never mutates. */
export function withTranscriptionStatus(
  manifest: RecordingManifest,
  status: TranscriptionStatus | null,
): RecordingManifest {
  return { ...manifest, transcription: status };
}

/**
 * ISO-8601 with the local UTC offset (`2026-09-05T14:02:11+02:00`), the form
 * the PRD example uses. `Date.prototype.toISOString` gives `Z`, which loses
 * the wall-clock the person actually recorded at.
 */
export function isoWithOffset(ms: number, offsetMinutes = new Date(ms).getTimezoneOffset()): string {
  const local = new Date(ms - offsetMinutes * 60_000);
  const base = local.toISOString().slice(0, 19);
  if (offsetMinutes === 0) return `${base}+00:00`;
  const sign = offsetMinutes <= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${base}${sign}${hh}:${mm}`;
}

export interface MacRecordingFacts {
  /** ms-epoch capture began. */
  startedAtMs: number;
  /** Pause-aware recorded length. */
  durationSecs: number;
  /** Exact on-disk size of the finalized WAV. */
  bytes: number;
  sampleRate: number;
  /** Basename of the audio file inside the bundle. */
  audioFile: string;
  device: string;
  appVersion: string;
  language?: string;
}

/**
 * The manifest the Mac writes for its own bundles after `stop_recording`, so
 * the format is bilateral: a phone can show a Mac recording with its
 * duration, and the scanner treats both kinds of bundle by one rule.
 * `codec: "pcm"` — the desktop recorder writes 16-bit mono WAV.
 */
export function createMacRecordingManifest(facts: MacRecordingFacts): RecordingManifest {
  const manifest: RecordingManifest = {
    version: RECORDING_MANIFEST_VERSION,
    createdBy: { device: facts.device, app: "notesage-macos", appVersion: facts.appVersion },
    startedAt: isoWithOffset(facts.startedAtMs),
    durationSecs: facts.durationSecs,
    source: "microphone",
    audio: {
      file: facts.audioFile,
      bytes: facts.bytes,
      codec: "pcm",
      sampleRate: facts.sampleRate,
      channels: 1,
    },
    transcription: null,
  };
  if (facts.language && facts.language !== "auto") manifest.language = facts.language;
  return manifest;
}
