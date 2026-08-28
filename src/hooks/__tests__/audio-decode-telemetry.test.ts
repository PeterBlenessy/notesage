// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect } from "vitest";
import { audioContainerOf, isDecodeFailure } from "@/hooks/useTranscriptionJob";

describe("audioContainerOf (#803 telemetry)", () => {
  it.each([
    ["/x/Meeting/audio.wav", "wav"],
    ["/x/memo.m4a", "m4a"],
    ["/x/podcast.mp3", "mp3"],
    ["/x/track.flac", "flac"],
    ["/x/voice.ogg", "ogg"],
    ["/x/clip.caf", "caf"],
  ])("buckets %s as %s", (path, expected) => {
    expect(audioContainerOf(path)).toBe(expected);
  });

  it("folds both aiff spellings into one bucket", () => {
    // Two extensions, one format. Splitting them would double a row in the
    // dashboard for no reason anyone reading it cares about.
    expect(audioContainerOf("/x/a.aif")).toBe("aiff");
    expect(audioContainerOf("/x/a.aiff")).toBe("aiff");
  });

  it("buckets anything unrecognised as other, never the raw extension", () => {
    // The cardinality guarantee: a user can name a file anything, and this
    // event must stay a small fixed set regardless.
    expect(audioContainerOf("/x/weird.qqq")).toBe("other");
    expect(audioContainerOf("/x/no-extension")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(audioContainerOf("/x/MEMO.M4A")).toBe("m4a");
  });
});

describe("isDecodeFailure (#803 telemetry)", () => {
  /**
   * The signal is "how often does a container defeat BOTH decoders". Every
   * other failure in the job lands in the same catch — a missing Whisper
   * model, a transcription error — and counting those as decode failures
   * would inflate the one number this event exists to produce.
   */
  it.each([
    "Unrecognised audio format: unsupported",
    "Unsupported audio codec: opus",
    "File contains no audio track",
    "Audio file decoded to no samples",
    "Unrecognised audio format (CoreAudio also failed: bad file)",
  ])("recognises %s as a decode failure", (message) => {
    expect(isDecodeFailure(message)).toBe(true);
  });

  it.each([
    "Whisper model not found: ggml-small.bin",
    "Audio file not found: /x/gone.wav",
    "Transcription was cancelled",
    "Failed to write transcript",
  ])("does not count %s as a decode failure", (message) => {
    expect(isDecodeFailure(message)).toBe(false);
  });

  it("handles a thrown Error, not only a string", () => {
    expect(isDecodeFailure(new Error("Unsupported audio codec: opus"))).toBe(true);
  });
});
