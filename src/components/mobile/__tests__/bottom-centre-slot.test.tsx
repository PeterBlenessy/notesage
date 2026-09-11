// @vitest-environment jsdom

/**
 * The bottom-centre slot has one owner on each side of the bridge (#995).
 *
 * Four things want that strip of screen — the search pill, the read-aloud
 * transport, the recording island, and a passive status line — and three
 * times now one of them was drawn by whoever happened to render it and landed
 * on top of another:
 *
 *   - the search island over the recorder's Pause and Stop, so a recording
 *     could be started and then not stopped (device, build 50);
 *   - the web sweep indicator under the native search island, showing
 *     something unreadable for a moment (device, build 60, #995);
 *   - the player and the search pill both pinned at the same offset, which
 *     collides as soon as an article is read aloud with find open.
 *
 * The fix is an ownership rule rather than three more offsets:
 *
 *   - GEOMETRY belongs to `ChromeOverlay.layoutBottomColumn` in Swift, which
 *     stacks every occupant. Not testable from here; its own comment carries
 *     the order, and the iOS Swift type-check job compiles it.
 *   - DECLARATION belongs to `useNativeChrome`, which is the only thing that
 *     calls `ios_set_chrome`. That IS testable from here, and it is what
 *     stops a fifth occupant being added without the arbiter seeing it.
 *
 * So these tests pin the declaration side: everything bound for that slot
 * goes through one push, including the one piece of it that no screen owns.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Typed: an untyped `vi.fn()` gives `.mock.calls` an empty tuple, so reading
// `calls[i][0]` is a type error rather than a value.
const setChromeMock = vi.fn((_spec: Record<string, unknown>) => Promise.resolve());

vi.mock("@/lib/ios-api", () => ({
  iosSetChrome: (spec: Record<string, unknown>) => setChromeMock(spec),
  iosNavShellSetAction: () => Promise.resolve(),
}));

import { useNativeChrome, setNativeChromeAnswer } from "@/components/mobile/useNativeChrome";
import { setChromeStatus, resetChromeStatus } from "@/components/mobile/chrome-status";

/** The spec handed to the most recent `ios_set_chrome`. */
function lastSpec(): Record<string, unknown> {
  const calls = setChromeMock.mock.calls;
  expect(calls.length, "nothing was declared").toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

describe("the bottom-centre slot is declared in one place", () => {
  beforeEach(() => {
    setChromeMock.mockClear();
    resetChromeStatus();
    setNativeChromeAnswer(null);
  });
  afterEach(() => {
    resetChromeStatus();
    setNativeChromeAnswer(null);
  });

  it("sends the search pill, the transport and the recorder in a single push", async () => {
    renderHook(() =>
      useNativeChrome(
        {
          search: { placeholder: "Search" },
          bottomCenter: { playing: true, position: "3 / 41", rate: "1.5×" },
          bottomRecorder: {
            elapsed: "02:14",
            paused: false,
            level: 0.4,
            interrupted: false,
          },
        },
        {},
      ),
    );

    await waitFor(() => expect(setChromeMock).toHaveBeenCalled());
    // One call, carrying all three — not three calls racing each other for
    // the same strip of screen.
    expect(setChromeMock).toHaveBeenCalledTimes(1);
    const spec = lastSpec();
    expect(spec.search).toBeTruthy();
    expect(spec.bottomCenter).toBeTruthy();
    expect(spec.bottomRecorder).toBeTruthy();
  });

  it("merges the app-global status line into the current screen's spec", async () => {
    // The sweep is not a property of any screen: it runs whichever one is up,
    // and it can start from a share that arrived while the app was closed.
    // Threading it through every screen's spec would make an app-global fact
    // into a prop on each of them, so `useNativeChrome` folds it in instead.
    renderHook(() => useNativeChrome({ search: { placeholder: "Search" } }, {}));
    await waitFor(() => expect(setChromeMock).toHaveBeenCalled());
    expect(lastSpec().bottomStatus).toBeUndefined();

    act(() => setChromeStatus({ label: "Saving 2 of 4 for offline", busy: true }));

    await waitFor(() =>
      expect(lastSpec().bottomStatus).toEqual({
        label: "Saving 2 of 4 for offline",
        busy: true,
      }),
    );
    // The screen's own chrome is untouched by a status arriving.
    expect(lastSpec().search).toEqual({ placeholder: "Search" });
  });

  it("re-declares when the status clears, so the pill actually goes away", async () => {
    renderHook(() => useNativeChrome({ search: { placeholder: "Search" } }, {}));
    await waitFor(() => expect(setChromeMock).toHaveBeenCalled());

    act(() => setChromeStatus({ label: "Saving for offline", busy: true }));
    await waitFor(() => expect(lastSpec().bottomStatus).toBeTruthy());

    act(() => setChromeStatus(null));
    await waitFor(() => expect(lastSpec().bottomStatus).toBeUndefined());
  });

  it("does not re-push for a status that has not changed", async () => {
    // The sweep republishes on every swept document. An unchanged value that
    // still re-declared would be an `ios_set_chrome` round trip per document,
    // and every push rebuilds the search island's root view.
    renderHook(() => useNativeChrome({ search: { placeholder: "Search" } }, {}));
    await waitFor(() => expect(setChromeMock).toHaveBeenCalled());

    act(() => setChromeStatus({ label: "Saving for offline", busy: true }));
    await waitFor(() => expect(lastSpec().bottomStatus).toBeTruthy());
    const settled = setChromeMock.mock.calls.length;

    act(() => setChromeStatus({ label: "Saving for offline", busy: true }));
    expect(setChromeMock.mock.calls.length).toBe(settled);
  });

  it("keeps the status when the nav shell strips the TOP row", async () => {
    // The native navigation bar owns the top row and `useNativeChrome` blanks
    // those fields before pushing. The bottom islands are not navigation and
    // must survive that edit — the status included.
    const navShell = await import("@/components/mobile/nav-shell-state");
    act(() => navShell.setNavShellPresented(true));
    try {
      setChromeStatus({ label: "Saving for offline", busy: true });
      renderHook(() =>
        useNativeChrome({ topLeft: { id: "back", icon: "chevron.left" } }, {}),
      );
      await waitFor(() => expect(setChromeMock).toHaveBeenCalled());
      const spec = lastSpec();
      expect(spec.topLeft).toBeUndefined();
      expect(spec.bottomStatus).toBeTruthy();
    } finally {
      act(() => navShell.setNavShellPresented(false));
    }
  });
});
