// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useMobileStore } from "@/stores/mobile-store";
import {
  DISCARD_UNDER_SECS,
  formatElapsed,
  recoverRecording,
  startRecording,
  startRecordingEvents,
  stopRecording,
  syncRecordingState,
} from "@/lib/recording-controller";

const emit = (detail: Record<string, unknown>) =>
  window.dispatchEvent(new CustomEvent("notesage:recording", { detail }));

describe("recording-controller — the recorder belongs to the app", () => {
  let stop: () => void;
  beforeEach(() => {
    useMobileStore.getState().reset();
    stop = startRecordingEvents();
    return () => stop();
  });

  it("follows the native events into the store", () => {
    emit({ event: "started" });
    expect(useMobileStore.getState().recording.status).toBe("recording");
    emit({ event: "tick", elapsedSecs: 12.4, level: 0.6 });
    expect(useMobileStore.getState().recording).toMatchObject({ elapsedSecs: 12.4, level: 0.6 });
    emit({ event: "interrupted", reason: "began" });
    expect(useMobileStore.getState().recording).toMatchObject({ status: "paused", interrupted: true, level: 0 });
    emit({ event: "resumed" });
    expect(useMobileStore.getState().recording).toMatchObject({ status: "recording", interrupted: false });
    emit({ event: "paused" });
    expect(useMobileStore.getState().recording.status).toBe("paused");
    emit({ event: "finished" });
    expect(useMobileStore.getState().recording.status).toBe("idle");
  });

  it("starts natively and stops a running read-aloud first — one owner of the audio session", async () => {
    let started = 0;
    let speechStopped = 0;
    setMockInvokeHandler("ios_recording_start", () => {
      started += 1;
      return null;
    });
    setMockInvokeHandler("ios_speech_stop", () => {
      speechStopped += 1;
      return null;
    });
    useMobileStore.setState({
      speech: { relPath: "a.html", title: "A", playing: true, index: 0, total: 3, rate: 1, language: "en" },
    });
    await startRecording("sv");
    expect(started).toBe(1);
    expect(speechStopped).toBe(1);
    expect(useMobileStore.getState().speech).toBeNull();
    expect(useMobileStore.getState().recording.status).toBe("recording");
    // A second start while recording is a no-op.
    await startRecording();
    expect(started).toBe(1);
  });

  it("a denied microphone is said plainly and remembered", async () => {
    const { toast } = await import("sonner");
    setMockInvokeHandler("ios_recording_start", () => {
      throw new Error("microphone-denied");
    });
    await startRecording();
    expect(useMobileStore.getState().recording).toMatchObject({ status: "idle", micPermission: "denied" });
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Recording needs the microphone. Turn it on in Settings.",
      expect.objectContaining({ action: expect.objectContaining({ label: "Open Settings" }) }),
    );
  });

  it("a stop under five seconds asks before keeping nothing; a real recording is saved", async () => {
    const stops: boolean[] = [];
    setMockInvokeHandler("ios_recording_stop", (args) => {
      const discard = (args as { discard: boolean }).discard;
      stops.push(discard);
      return { relPath: discard ? null : "Recordings/Recording 2026-09-05 14-02-11", manifest: discard ? null : "{}" };
    });
    useMobileStore.getState().setRecording({ status: "recording", elapsedSecs: DISCARD_UNDER_SECS - 1 });
    const askedDiscard = await stopRecording({ confirmDiscard: async () => true });
    expect(askedDiscard).toBeNull();
    expect(stops).toEqual([true]);
    expect(useMobileStore.getState().recording.status).toBe("idle");

    useMobileStore.getState().setRecording({ status: "recording", elapsedSecs: 90 });
    const saved = await stopRecording({ confirmDiscard: async () => true });
    expect(saved).toBe("Recordings/Recording 2026-09-05 14-02-11");
    expect(stops).toEqual([true, false]);
  });

  it("asks the native recorder where things stand, including an orphan a force-quit left", async () => {
    setMockInvokeHandler("ios_recording_state", () => ({
      status: "idle",
      elapsedSecs: 0,
      level: 0,
      interrupted: false,
      micPermission: "granted",
      orphan: { dir: "ABC", readable: true, durationSecs: 61 },
    }));
    await syncRecordingState();
    expect(useMobileStore.getState().recording.orphan).toEqual({ dir: "ABC", readable: true, durationSecs: 61 });
    let recovered: [string, string] | null = null;
    setMockInvokeHandler("ios_recording_recover", (args) => {
      const a = args as { action: string; dir: string };
      recovered = [a.action, a.dir];
      return "Recordings/Recording 2026-09-05 13-00-00";
    });
    expect(await recoverRecording("keep")).toBe("Recordings/Recording 2026-09-05 13-00-00");
    expect(recovered).toEqual(["keep", "ABC"]);
    expect(useMobileStore.getState().recording.orphan).toBeNull();
  });

  it("formats elapsed time like a clock", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(134.7)).toBe("02:14");
    expect(formatElapsed(3725)).toBe("1:02:05");
  });
});
