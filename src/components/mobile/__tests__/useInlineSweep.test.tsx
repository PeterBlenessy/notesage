// @vitest-environment jsdom
/**
 * The background image sweep (task #1.5).
 *
 * What is worth pinning here is not "it calls the command" but the guards —
 * each exists because without it the sweep does something actively harmful,
 * and none of them are visible from reading the happy path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import "@/test/tauri-mock";

const listDirectoryMock = vi.fn<(rel: string) => Promise<unknown[]>>();
const inlineMock =
  vi.fn<(rel: string, opts?: { maxPixel?: number; jpegQuality?: number }) => Promise<number>>();
vi.mock("@/lib/ios-api", () => ({
  iosListDirectory: (rel: string) => listDirectoryMock(rel),
  iosInlineArticleImages: (rel: string, opts?: { maxPixel?: number; jpegQuality?: number }) =>
    inlineMock(rel, opts),
}));

const evictMock = vi.fn<(path: string) => void>();
vi.mock("@/lib/mobile-thumbnails", () => ({
  evictThumbnail: (p: string) => evictMock(p),
}));

import { useInlineSweep, INLINE_SWEEP_EVENT } from "../useInlineSweep";
import { useMobileStore } from "@/stores/mobile-store";

function entry(name: string, extra: Record<string, unknown> = {}) {
  return { name, path: `Inbox/${name}`, is_directory: false, hidden: false, ...extra };
}

beforeEach(() => {
  listDirectoryMock.mockReset();
  inlineMock.mockReset();
  evictMock.mockReset();
  inlineMock.mockResolvedValue(1);
  useMobileStore.setState({ openDoc: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what gets swept", () => {
  it("inlines html captures and ignores everything else", async () => {
    listDirectoryMock.mockResolvedValue([
      entry("article.html"),
      entry("note.md"),
      entry("photo.jpg"),
      entry("Sub", { is_directory: true }),
    ]);

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalled());
    expect(inlineMock.mock.calls.map((c) => c[0])).toEqual(["Inbox/article.html"]);
  });

  it("does not rewrite the document the user is reading", async () => {
    // Swapping the file under a reader mid-scroll is worse than leaving it
    // linked for one more session.
    useMobileStore.setState({ openDoc: { relPath: "Inbox/open.html", name: "open.html" } });
    listDirectoryMock.mockResolvedValue([entry("open.html"), entry("other.html")]);

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalled());
    expect(inlineMock.mock.calls.map((c) => c[0])).toEqual(["Inbox/other.html"]);
  });

  it("skips entirely when offline", async () => {
    // Every fetch would fail and every document would be marked attempted,
    // burning this session's one cheap retry for nothing.
    vi.stubGlobal("navigator", { onLine: false });
    listDirectoryMock.mockResolvedValue([entry("article.html")]);

    renderHook(() => useInlineSweep());

    await new Promise((r) => setTimeout(r, 10));
    expect(inlineMock).not.toHaveBeenCalled();
  });

  it("survives a library with no Inbox", async () => {
    // Nothing has ever been shared. Not an error state.
    listDirectoryMock.mockRejectedValue(new Error("No such directory"));
    const { result } = renderHook(() => useInlineSweep());

    await act(async () => {
      await result.current.sweep();
    });
    expect(inlineMock).not.toHaveBeenCalled();
  });
});

describe("after a document is rewritten", () => {
  it("evicts the stale thumbnail and announces the change", async () => {
    // The thumbnail cache is keyed by path and never expires. Without the
    // eviction the article keeps the text-only thumbnail taken BEFORE the
    // sweep, and the whole fix looks like it did nothing.
    //
    // The announcement carries no payload: it is throttled and coalesced now,
    // so one event can stand for several documents. Listeners reload the
    // listing rather than acting on a specific path.
    listDirectoryMock.mockResolvedValue([entry("article.html")]);
    let announced = 0;
    window.addEventListener(INLINE_SWEEP_EVENT, () => {
      announced += 1;
    });

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(evictMock).toHaveBeenCalledWith("Inbox/article.html"));
    await waitFor(() => expect(announced).toBeGreaterThan(0));
  });

  it("coalesces announcements instead of one per document", async () => {
    // Each announcement rebuilds the whole listing. One per document is fine
    // for a few Inbox items and ruinous for the retroactive pass, which is
    // hundreds.
    listDirectoryMock.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => entry(`a${i}.html`)),
    );
    let announced = 0;
    window.addEventListener(INLINE_SWEEP_EVENT, () => {
      announced += 1;
    });

    const { result } = renderHook(() => useInlineSweep());
    await act(async () => {
      await result.current.sweep();
    });

    expect(inlineMock).toHaveBeenCalledTimes(8);
    // Far fewer events than documents; the exact count depends on timing, so
    // assert the property that matters rather than a number.
    expect(announced).toBeLessThan(8);
    expect(announced).toBeGreaterThan(0);
  });

  it("retries a document that failed, rather than burning the session on it", async () => {
    // A flaky network used to cost a document its only attempt: it was marked
    // attempted BEFORE the call, so it was skipped for the rest of the session
    // even once signal returned.
    listDirectoryMock.mockResolvedValue([entry("flaky.html")]);
    inlineMock.mockRejectedValueOnce(new Error("network died"));

    const { result } = renderHook(() => useInlineSweep());
    await waitFor(() => expect(inlineMock).toHaveBeenCalledTimes(1));

    inlineMock.mockResolvedValue(1);
    await act(async () => {
      await result.current.sweep();
    });

    expect(inlineMock).toHaveBeenCalledTimes(2);
    expect(evictMock).toHaveBeenCalledWith("Inbox/flaky.html");
  });

  it("stays quiet when nothing was embedded", async () => {
    // 0 means the document was already self-contained. Evicting a good
    // thumbnail and reloading the listing would be pure churn.
    inlineMock.mockResolvedValue(0);
    listDirectoryMock.mockResolvedValue([entry("article.html")]);

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalled());
    expect(evictMock).not.toHaveBeenCalled();
  });
});

describe("resilience", () => {
  it("keeps going after one document fails", async () => {
    // A single corrupt or unreachable article must not strand the rest.
    inlineMock.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(1);
    listDirectoryMock.mockResolvedValue([entry("bad.html"), entry("good.html")]);

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalledTimes(2));
    expect(evictMock).toHaveBeenCalledWith("Inbox/good.html");
  });

  it("does not re-attempt a document within the same session", async () => {
    // Correctness does not depend on this — the command returns 0 for an
    // already-swept file — but re-reading every Inbox file on every single
    // foreground is real IPC and real disk for a guaranteed no-op.
    listDirectoryMock.mockResolvedValue([entry("article.html")]);
    const { result } = renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await result.current.sweep();
    });

    expect(inlineMock).toHaveBeenCalledTimes(1);
  });
});

describe("the passive indicator", () => {
  it("shows nothing when no sweep is running", async () => {
    const { SweepIndicator } = await import("../SweepIndicator");
    const { render } = await import("@testing-library/react");
    const { container } = render(
      <SweepIndicator progress={{ active: false, done: 0, total: 3 }} />,
    );
    // Not "hidden" — absent. A dormant indicator is chrome the user has to
    // learn to ignore.
    expect(container.textContent).toBe("");
  });

  it("omits the count for a single document", async () => {
    const { SweepIndicator } = await import("../SweepIndicator");
    const { render, screen } = await import("@testing-library/react");
    render(<SweepIndicator progress={{ active: true, done: 0, total: 1 }} />);

    // "1 of 1" reads as a progress bar for something already finished.
    expect(screen.getByRole("status").textContent).not.toMatch(/1/);
  });

  it("counts from one, not zero, when there are several", async () => {
    const { SweepIndicator } = await import("../SweepIndicator");
    const { render, screen } = await import("@testing-library/react");
    render(<SweepIndicator progress={{ active: true, done: 1, total: 4 }} />);

    // `done` is how many are FINISHED; the user wants to know which one is in
    // flight, so the second document reads as "2 of 4", never "1 of 4".
    expect(screen.getByRole("status").textContent).toMatch(/2 of 4/);
  });

  it("announces politely rather than stealing focus", async () => {
    const { SweepIndicator } = await import("../SweepIndicator");
    const { render, screen } = await import("@testing-library/react");
    render(<SweepIndicator progress={{ active: true, done: 0, total: 2 }} />);

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});

describe("settings (#2.2)", () => {
  it("does nothing at all when the sweep is turned off", async () => {
    useMobileStore.setState({ inlineImagesEnabled: false });
    listDirectoryMock.mockResolvedValue([entry("article.html")]);

    renderHook(() => useInlineSweep());

    await new Promise((r) => setTimeout(r, 10));
    // Not even the listing is read — off means off, not "do it quietly".
    expect(listDirectoryMock).not.toHaveBeenCalled();
    useMobileStore.setState({ inlineImagesEnabled: true });
  });

  it("passes the configured size and quality to the native job", async () => {
    useMobileStore.setState({ imageMaxPixel: 1200, imageQuality: 0.6 });
    listDirectoryMock.mockResolvedValue([entry("article.html")]);

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalled());
    expect(inlineMock).toHaveBeenCalledWith("Inbox/article.html", {
      maxPixel: 1200,
      jpegQuality: 0.6,
    });
  });

  it("sends an explicit 0 for 'original', never undefined", async () => {
    // Undefined would mean "no preference" and the command would apply its
    // 1600 default — silently downsampling the images of a user who asked for
    // originals. 0 means "no cap".
    useMobileStore.setState({ imageMaxPixel: "original" });
    listDirectoryMock.mockResolvedValue([entry("article.html")]);

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalled());
    expect(inlineMock.mock.calls[0][1]).toMatchObject({ maxPixel: 0 });
    useMobileStore.setState({ imageMaxPixel: 1600 });
  });

  it("reads the settings once per sweep, not once per document", async () => {
    // A change mid-sweep must not produce one article at 2048 and the next at
    // 1200 — an inconsistency invisible until someone compares two files.
    useMobileStore.setState({ imageMaxPixel: 2048 });
    listDirectoryMock.mockResolvedValue([entry("a.html"), entry("b.html")]);
    inlineMock.mockImplementation(async () => {
      useMobileStore.setState({ imageMaxPixel: 1200 });
      return 1;
    });

    renderHook(() => useInlineSweep());

    await waitFor(() => expect(inlineMock).toHaveBeenCalledTimes(2));
    const sizes = inlineMock.mock.calls.map((c) => (c[1] as { maxPixel: number }).maxPixel);
    expect(sizes).toEqual([2048, 2048]);
    useMobileStore.setState({ imageMaxPixel: 1600 });
  });
});

