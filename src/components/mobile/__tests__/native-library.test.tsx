// @vitest-environment jsdom

/**
 * Handing folder browsing to the native screen (#1000).
 *
 * The hook does two things, and both are the kind that fail silently: it
 * pushes the section-header strings across, and it answers the taps the
 * native screen sends back. A wrong string table shows up as an English
 * header in a Swedish app (#989, three builds unnoticed); a dropped tap shows
 * up as a row that does nothing.
 */

// Storage FIRST, before the store: zustand's `persist` reads it while the
// module initialises, and Node 22+ leaves `localStorage` an own property whose
// value is undefined. See `@/test/local-storage`.
import "@/test/local-storage";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const setBrowsingMock = vi.fn((_args: { enabled: boolean; strings?: Record<string, string> }) =>
  Promise.resolve(),
);
interface SpeechArgs {
  relPath: string | null;
  playing: boolean;
  fraction: number;
  recording: boolean;
}
const setSpeechMock = vi.fn((_args: SpeechArgs) => Promise.resolve());
const toggleSpeechMock = vi.fn((_entry: { path: string; name: string }) => {});

vi.mock("@/lib/ios-api", () => ({
  iosSetLibraryBrowsing: (args: { enabled: boolean; strings?: Record<string, string> }) =>
    setBrowsingMock(args),
  iosSetLibrarySpeech: (args: SpeechArgs) => setSpeechMock(args),
}));

vi.mock("@/lib/speech-controller", () => ({
  toggleSpeech: (entry: { path: string; name: string }) => toggleSpeechMock(entry),
}));

import { renderHook, act, waitFor } from "@testing-library/react";
import { useNativeLibrary, useNativeLibrarySpeech } from "@/components/mobile/useNativeLibrary";
import { useMobileStore } from "@/stores/mobile-store";
import { setLocale } from "@/lib/i18n";

function fireOpen(kind: string, relPath: string) {
  window.dispatchEvent(
    new CustomEvent("notesage:nav-shell", { detail: { type: "open", kind, relPath } }),
  );
}

beforeEach(() => {
  setBrowsingMock.mockReset();
  setBrowsingMock.mockResolvedValue(undefined);
  setSpeechMock.mockReset();
  setSpeechMock.mockResolvedValue(undefined);
  toggleSpeechMock.mockReset();
  useMobileStore.setState({ folderStack: [], openDoc: null, docStack: [] });
});
afterEach(() => setLocale("en"));

describe("useNativeLibrary", () => {
  it("does nothing at all while the library is not granted", () => {
    renderHook(() => useNativeLibrary(false));
    expect(setBrowsingMock).not.toHaveBeenCalled();
  });

  it("turns the native surface on and reports it live", async () => {
    const { result } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(setBrowsingMock.mock.calls[0][0].enabled).toBe(true);
  });

  it("stays web when there is no native layer to answer", async () => {
    // Desktop dev, the vitest suite, a build without the command: the web
    // browser keeps rendering rather than the app showing an empty screen.
    setBrowsingMock.mockRejectedValue(new Error("only available on iOS"));
    const { result } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(setBrowsingMock).toHaveBeenCalled());
    expect(result.current).toBe(false);
  });

  it("hands over every string the native screen draws", async () => {
    renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(setBrowsingMock).toHaveBeenCalled());
    const strings = setBrowsingMock.mock.calls[0][0].strings ?? {};

    // The Swift enum names these; a key added there without one here renders
    // as the raw key. That is a visible bug, which is the point — the failure
    // to avoid is a silently English header.
    for (const key of [
      "section.pinned",
      "section.folders",
      "section.allNotes",
      "section.recent",
      "section.recentlyChanged",
      "section.kind.markdown",
      "section.kind.text",
      "section.kind.pdf",
      "section.kind.image",
      "section.kind.media",
      "section.kind.doc",
      "section.kind.html",
      "section.kind.other",
      // The swipe titles travel with them: the native screen draws the
      // gesture, so it needs the words.
      "action.share",
      "action.delete",
    ]) {
      expect(strings[key], `missing ${key}`).toBeTruthy();
      expect(strings[key], `${key} was handed over as its own key`).not.toBe(key);
    }
  });

  it("hands the reading-time messages over as TEMPLATES, placeholders intact", async () => {
    // The numbers are only known in Swift, so what crosses has to be the
    // template — "{left} of {total} min left" — not a resolved string. Calling
    // `t()` with variables here would look harmless and would silently ship
    // rows reading "0 of 0 min left", so the braces are the assertion.
    renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(setBrowsingMock).toHaveBeenCalled());
    const strings = setBrowsingMock.mock.calls[0][0].strings ?? {};

    expect(strings["list.minutes"]).toContain("{total}");
    expect(strings["list.minutesLeft"]).toContain("{left}");
    expect(strings["list.minutesLeft"]).toContain("{total}");
    // "Read" has no placeholder — it is a finished string, and it still has
    // to travel, or a finished article shows nothing where its state goes.
    expect(strings["list.read"]).toBeTruthy();
  });

  it("translates the templates without resolving them", async () => {
    setLocale("sv");
    renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(setBrowsingMock).toHaveBeenCalled());
    const strings = setBrowsingMock.mock.calls[0][0].strings ?? {};
    // Swedish word order differs — "5 av 10 min kvar" — which is exactly why
    // Swift interpolates a translated template rather than assembling the
    // line itself.
    expect(strings["list.minutesLeft"]).toBe("{left} av {total} min kvar");
    expect(strings["list.read"]).toBe("Läst");
  });

  it("hands over the ACTIVE language, and again when it changes", async () => {
    setLocale("sv");
    const { rerender } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(setBrowsingMock).toHaveBeenCalled());
    expect(setBrowsingMock.mock.calls[0][0].strings?.["section.pinned"]).toBe("Fastnålade");

    act(() => setLocale("en"));
    rerender();
    await waitFor(() =>
      expect(
        setBrowsingMock.mock.calls[setBrowsingMock.mock.calls.length - 1][0].strings?.[
          "section.pinned"
        ],
      ).toBe("Pinned"),
    );
  });

  it("pushes a folder tap into the store", async () => {
    const { result } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(result.current).toBe(true));

    act(() => fireOpen("folder", "Projects/Ideas"));
    const stack = useMobileStore.getState().folderStack;
    expect(stack[stack.length - 1]?.relPath).toBe("Projects/Ideas");
    // The row showed the last segment, so the breadcrumb must too.
    expect(stack[stack.length - 1]?.name).toBe("Ideas");
  });

  it("opens a document tap", async () => {
    const { result } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(result.current).toBe(true));

    act(() => fireOpen("document", "Inbox/Alpha.md"));
    expect(useMobileStore.getState().openDoc?.relPath).toBe("Inbox/Alpha.md");
  });

  it("ignores nav-shell events that are not an open", async () => {
    const { result } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      window.dispatchEvent(
        new CustomEvent("notesage:nav-shell", { detail: { type: "didPop", screenId: "x" } }),
      );
    });
    expect(useMobileStore.getState().folderStack).toEqual([]);
    expect(useMobileStore.getState().openDoc).toBeNull();
  });

  it("listens for nothing until the native side has answered", () => {
    // A tap cannot arrive before the surface is live, and wiring the listener
    // early would mean a stray event moved the store on a web-only build.
    setBrowsingMock.mockReturnValue(new Promise(() => {}));
    renderHook(() => useNativeLibrary(true));
    act(() => fireOpen("folder", "Projects"));
    expect(useMobileStore.getState().folderStack).toEqual([]);
  });

  it("routes a Listen tap to the speech controller, not to opening the row", async () => {
    const { result } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(result.current).toBe(true));

    act(() => fireOpen("listen", "Inbox/Alpha.html"));
    expect(toggleSpeechMock).toHaveBeenCalledWith({ path: "Inbox/Alpha.html", name: "Alpha.html" });
    // Pressing Listen must not also open the article — the whole point of the
    // control is reading without opening (#833).
    expect(useMobileStore.getState().openDoc).toBeNull();
  });

  it("hands over the Listen control's three states", async () => {
    renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(setBrowsingMock).toHaveBeenCalled());
    const strings = setBrowsingMock.mock.calls[0][0].strings ?? {};
    // These are the disc's accessibility label, which is the only thing a
    // screen reader has to go on.
    for (const key of [
      "action.listen",
      "reader.listenPause",
      "reader.listenResume",
      "recording.inProgress",
    ]) {
      expect(strings[key], `missing ${key}`).toBeTruthy();
      expect(strings[key], `${key} was handed over as its own key`).not.toBe(key);
    }
  });

  it("removes its listener on unmount", async () => {
    const { result, unmount } = renderHook(() => useNativeLibrary(true));
    await waitFor(() => expect(result.current).toBe(true));
    unmount();

    act(() => fireOpen("folder", "Projects"));
    expect(useMobileStore.getState().folderStack).toEqual([]);
  });
});

describe("useNativeLibrarySpeech", () => {
  it("says nothing while the native surface is not live", () => {
    renderHook(() => useNativeLibrarySpeech(false));
    expect(setSpeechMock).not.toHaveBeenCalled();
  });

  it("pushes the idle state so the rows start from something", async () => {
    renderHook(() => useNativeLibrarySpeech(true));
    await waitFor(() => expect(setSpeechMock).toHaveBeenCalled());
    expect(setSpeechMock.mock.calls[0][0]).toEqual({
      relPath: null,
      playing: false,
      fraction: 0,
      recording: false,
    });
  });

  it("pushes what is playing, and the ring's fraction", async () => {
    const { rerender } = renderHook(() => useNativeLibrarySpeech(true));
    await waitFor(() => expect(setSpeechMock).toHaveBeenCalled());

    act(() => {
      useMobileStore.setState({
        speech: {
          relPath: "Inbox/Alpha.html",
          title: "Alpha",
          playing: true,
          index: 3,
          total: 12,
          rate: 1,
          language: "en",
        },
      });
    });
    rerender();

    await waitFor(() => {
      const last = setSpeechMock.mock.calls[setSpeechMock.mock.calls.length - 1][0];
      expect(last.relPath).toBe("Inbox/Alpha.html");
      expect(last.playing).toBe(true);
      // The same count the Reader's transport shows: paragraph 4 of 12. Both
      // surfaces are visible at once, so they have to agree.
      expect(last.fraction).toBeCloseTo(4 / 12);
    });
  });

  it("reports a recording, because it disables every control at once", async () => {
    const { rerender } = renderHook(() => useNativeLibrarySpeech(true));
    await waitFor(() => expect(setSpeechMock).toHaveBeenCalled());

    act(() => {
      useMobileStore.setState({
        recording: { ...useMobileStore.getState().recording, status: "recording" },
      });
    });
    rerender();

    await waitFor(() => {
      const last = setSpeechMock.mock.calls[setSpeechMock.mock.calls.length - 1][0];
      expect(last.recording).toBe(true);
    });
  });

  it("survives a build with no native speech command", async () => {
    setSpeechMock.mockRejectedValue(new Error("only available on iOS"));
    renderHook(() => useNativeLibrarySpeech(true));
    await waitFor(() => expect(setSpeechMock).toHaveBeenCalled());
    // Nothing to assert beyond "it did not throw" — an unhandled rejection
    // here would take the whole shell down.
  });
});
