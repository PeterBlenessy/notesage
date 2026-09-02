// @vitest-environment jsdom
import "@/test/local-storage";

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Typed explicitly: a bare `vi.fn(() => …)` infers an EMPTY parameter tuple,
// so every call site with an argument is a type error — and `pnpm test` would
// still be green, because vitest does not typecheck.
interface SpeechStartArgs {
  text: string;
  title: string;
  startIndex: number;
  rate: number;
  voiceByLanguage: Record<string, string>;
}
const speechStart = vi.fn<(args: SpeechStartArgs) => Promise<{ language: string | null }>>(
  () => Promise.resolve({ language: "en" }),
);
const speechSetVoice = vi.fn<(id: string) => Promise<void>>(() => Promise.resolve());
const speechPause = vi.fn<() => Promise<void>>(() => Promise.resolve());
const speechResume = vi.fn<() => Promise<void>>(() => Promise.resolve());
const speechStop = vi.fn<() => Promise<void>>(() => Promise.resolve());
const speechSkip = vi.fn<(delta: number) => Promise<void>>(() => Promise.resolve());
const speechSetRate = vi.fn<(rate: number) => Promise<void>>(() => Promise.resolve());

vi.mock("@/lib/ios-api", () => ({
  iosSpeechStart: (args: SpeechStartArgs) => speechStart(args),
  iosSpeechPause: () => speechPause(),
  iosSpeechResume: () => speechResume(),
  iosSpeechStop: () => speechStop(),
  iosSpeechSkip: (d: number) => speechSkip(d),
  iosSpeechSetRate: (r: number) => speechSetRate(r),
  iosSpeechSetVoice: (id: string) => speechSetVoice(id),
  // Real listener semantics: the native side dispatches a window CustomEvent.
  onIosSpeechEvent: (handler: (p: { event: string; index?: number; total?: number; playing?: boolean }) => void) => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.event) handler(detail);
    };
    window.addEventListener("notesage:speech", listener);
    return () => window.removeEventListener("notesage:speech", listener);
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { useSpeechPlayer } from "../useSpeechPlayer";
import { useMobileStore } from "@/stores/mobile-store";

function emitProgress(index: number, total: number) {
  window.dispatchEvent(
    new CustomEvent("notesage:speech", { detail: { event: "progress", index, total } }),
  );
}

function emitPlaying(playing: boolean) {
  window.dispatchEvent(
    new CustomEvent("notesage:speech", { detail: { event: "playing", playing } }),
  );
}

function emitFinished() {
  window.dispatchEvent(new CustomEvent("notesage:speech", { detail: { event: "finished" } }));
}

describe("useSpeechPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMobileStore.setState({ speechPositions: {}, speechVoices: {} });
  });

  it("starts at the persisted paragraph for this article", () => {
    useMobileStore.setState({ speechPositions: { "Inbox/a.html": 7 } });
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));

    act(() => result.current.start("one\n\ntwo", "A"));

    expect(speechStart).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 7, title: "A", text: "one\n\ntwo" }),
    );
    expect(result.current.state.index).toBe(7);
  });

  it("starts at 0 when the article has never been listened to", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/new.html"));
    act(() => result.current.start("text", "A"));
    expect(speechStart).toHaveBeenCalledWith(expect.objectContaining({ startIndex: 0 }));
  });

  it("refuses to start on a document with no prose", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("   \n\n  ", "A"));
    expect(speechStart).not.toHaveBeenCalled();
    expect(result.current.state.active).toBe(false);
  });

  it("persists progress as it plays", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    act(() => emitProgress(3, 10));

    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(3);
    expect(result.current.state).toMatchObject({ index: 3, total: 10, active: true });
  });

  it("ignores a progress event that arrives after the reader moved on", () => {
    // `iosSpeechStop` is fire-and-forget, so the native player can emit one
    // more paragraph after the reader has already opened something else. That
    // event must not stamp a position onto the new article — it would corrupt
    // a resume point the user never listened to.
    //
    // The ownership REF is what enforces this. Mutation-checked: replacing
    // `if (!owner) return` with a fallback to the current path fails here.
    const { result, rerender } = renderHook(
      ({ path }) => useSpeechPlayer(path),
      { initialProps: { path: "Inbox/a.html" } },
    );
    act(() => result.current.start("body", "A"));
    act(() => emitProgress(4, 9));
    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(4);

    // Navigate to a different document. The unmount effect clears ownership.
    rerender({ path: "Inbox/b.html" });
    act(() => emitProgress(8, 9));

    expect(useMobileStore.getState().speechPositions["Inbox/b.html"]).toBeUndefined();
    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(4);
  });

  it("retires the transport when the article finishes", () => {
    // Reaching the last paragraph used to arrive as a plain progress event,
    // which only ever sets `active: true` — so the bar sat there showing Pause
    // for an article that had already stopped, and tapping it republished the
    // finished article to the lock screen. (Review finding, Critical.)
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    act(() => emitProgress(40, 41));
    expect(result.current.state.active).toBe(true);

    act(() => emitFinished());
    expect(result.current.state.active).toBe(false);
    expect(result.current.state.playing).toBe(false);
  });

  it("rewinds to the top once an article has been heard to the end", () => {
    // Otherwise the next Listen resumes at the last paragraph and says almost
    // nothing before stopping again.
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    act(() => emitProgress(40, 41));
    act(() => emitFinished());
    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(0);
  });

  it("follows a pause driven from the lock screen", () => {
    // The lock screen and Control Centre call the native player directly and
    // never touch this code; without the `playing` event the transport keeps
    // showing the wrong icon and the next tap calls the wrong method.
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    expect(result.current.state.playing).toBe(true);

    act(() => emitPlaying(false));
    expect(result.current.state.playing).toBe(false);

    act(() => emitPlaying(true));
    expect(result.current.state.playing).toBe(true);
  });

  it("ignores a finished event for an article that is no longer playing", () => {
    const { result, rerender } = renderHook(({ path }) => useSpeechPlayer(path), {
      initialProps: { path: "Inbox/a.html" },
    });
    act(() => result.current.start("body", "A"));
    act(() => emitProgress(5, 9));
    rerender({ path: "Inbox/b.html" });
    act(() => emitFinished());
    // The old article keeps the position it actually reached.
    expect(useMobileStore.getState().speechPositions["Inbox/a.html"]).toBe(5);
  });

  it("stops native playback when the document changes", () => {
    const { rerender } = renderHook(({ path }) => useSpeechPlayer(path), {
      initialProps: { path: "Inbox/a.html" },
    });
    expect(speechStop).not.toHaveBeenCalled();
    rerender({ path: "Inbox/b.html" });
    expect(speechStop).toHaveBeenCalled();
  });

  it("stops native playback when the reader closes", () => {
    const { unmount } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    unmount();
    expect(speechStop).toHaveBeenCalled();
  });

  it("converts the user-facing rate onto AVSpeechUtterance's 0…1 axis", () => {
    // AVSpeechUtteranceDefaultSpeechRate is 0.5, not 1.0 — "normal" sits in
    // the middle of the axis. Without the halving, 1× would be double speed.
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    expect(speechStart).toHaveBeenCalledWith(expect.objectContaining({ rate: 0.5 }));

    act(() => result.current.cycleRate());
    expect(result.current.state.rate).toBe(1.25);
    expect(speechSetRate).toHaveBeenCalledWith(0.625);
  });

  it("cycles rate and wraps at the end", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      act(() => result.current.cycleRate());
      seen.push(result.current.state.rate);
    }
    expect(seen).toEqual([1.25, 1.5, 2.0, 0.8, 1.0]);
  });

  it("pause and resume drive the native player and the flag together", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    expect(result.current.state.playing).toBe(true);

    act(() => result.current.pause());
    expect(speechPause).toHaveBeenCalled();
    expect(result.current.state.playing).toBe(false);

    act(() => result.current.resume());
    expect(speechResume).toHaveBeenCalled();
    expect(result.current.state.playing).toBe(true);
  });

  it("passes the user's own voice picks to the native side", () => {
    // There is no API for "the voice the user chose in Settings", so the app
    // remembers it and hands it over; the native side lets it win.
    useMobileStore.setState({ speechVoices: { en: "com.apple.voice.premium.en-US.Ava" } });
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.start("body", "A"));
    expect(speechStart).toHaveBeenCalledWith(
      expect.objectContaining({ voiceByLanguage: { en: "com.apple.voice.premium.en-US.Ava" } }),
    );
  });

  it("learns the article's language from the native side", async () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    await act(async () => {
      result.current.start("body", "A");
      await Promise.resolve();
    });
    expect(result.current.state.language).toBe("en");
  });

  it("remembers a chosen voice for the language and applies it live", async () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    await act(async () => {
      result.current.start("body", "A");
      await Promise.resolve();
    });
    act(() => result.current.chooseVoice("com.apple.voice.premium.en-GB.Daniel"));
    expect(useMobileStore.getState().speechVoices.en).toBe("com.apple.voice.premium.en-GB.Daniel");
    expect(speechSetVoice).toHaveBeenCalledWith("com.apple.voice.premium.en-GB.Daniel");
  });

  it("does not record a voice before the language is known", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.chooseVoice("x"));
    expect(useMobileStore.getState().speechVoices).toEqual({});
    expect(speechSetVoice).not.toHaveBeenCalled();
  });

  it("skip forwards the delta unchanged", () => {
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    act(() => result.current.skip(-1));
    expect(speechSkip).toHaveBeenCalledWith(-1);
  });

  it("clears the player when the native side is unavailable", async () => {
    speechStart.mockRejectedValueOnce(new Error("only available on iOS"));
    const { result } = renderHook(() => useSpeechPlayer("Inbox/a.html"));
    await act(async () => {
      result.current.start("body", "A");
      await Promise.resolve();
    });
    // A bar that controls nothing is worse than no bar.
    expect(result.current.state.active).toBe(false);
  });
});
