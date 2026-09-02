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
  voiceId?: string | null;
}
const speechStart = vi.fn<(args: SpeechStartArgs) => Promise<void>>(() => Promise.resolve());
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
  // Real listener semantics: the native side dispatches a window CustomEvent.
  onIosSpeechProgress: (handler: (p: { event: string; index: number; total: number }) => void) => {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.event === "progress") handler(detail);
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

describe("useSpeechPlayer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMobileStore.setState({ speechPositions: {} });
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
