// @vitest-environment jsdom

/**
 * A row that already has its thumbnail must never blank on remount (#994
 * follow-up, found on device in build 61).
 *
 * `MobileApp` renders `openDoc ? <Reader/> : <LibraryBrowser/>`, so opening a
 * document unmounts every row and closing it mounts fresh ones. #994 fixed the
 * LISTING half of that — the rows come back instantly from a cache instead of
 * via a skeleton. Then the thumbnail prefetch moved the fetch from mount to
 * intersection, and an IntersectionObserver delivers a frame or more later. So
 * the list came back instantly with every tile EMPTY and the pictures popped
 * in afterwards: the blink got worse, in the change meant to cure it.
 *
 * The rule this pins: what is already known is read during render. Not in an
 * effect, not after an observer, not a microtask later — during render, so the
 * very first paint after a remount carries the picture.
 *
 * These assert on the OBSERVER too, because "does it eventually show the
 * thumbnail" passes either way — the regression was entirely about WHEN.
 *
 * A note on what each test can and cannot see. Testing Library flushes effects
 * inside `render`, so markup assertions cannot by themselves tell "read during
 * render" from "read in an effect that ran immediately after". The observer
 * assertion is the one that distinguishes them: a card that already has its
 * picture must arm nothing at all. Both fail on the regression as it actually
 * shipped; only the observer one fails if the read is merely moved into an
 * effect, which is the near-miss worth catching.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const getThumbnailMock = vi.fn();
const peekThumbnailMock = vi.fn();

vi.mock("@/lib/mobile-thumbnails", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mobile-thumbnails")>();
  return {
    ...actual,
    getThumbnail: (...args: unknown[]) => getThumbnailMock(...args),
    peekThumbnail: (...args: unknown[]) => peekThumbnailMock(...args),
  };
});

/** Records every observer built, so a test can assert none was. */
class FakeObserver {
  static instances: FakeObserver[] = [];
  constructor(
    public callback: IntersectionObserverCallback,
    public options?: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

import { render, screen } from "@testing-library/react";
import { GalleryCard } from "@/components/mobile/GalleryCard";
import type { FileEntry } from "@/lib/tauri";

const noopActions = {
  onChanged: () => {},
  onOpen: () => {},
} as unknown as Parameters<typeof GalleryCard>[0]["actionContext"];

function entry(name: string): FileEntry {
  return { name, path: name, is_directory: false, hidden: false, modified: 1 };
}

function renderCard() {
  return render(
    <GalleryCard
      entry={entry("a.md")}
      currentFolderName="Ideas"
      theme="light"
      onActivate={() => {}}
      actionContext={noopActions}
    />,
  );
}

beforeEach(() => {
  FakeObserver.instances = [];
  getThumbnailMock.mockReset();
  peekThumbnailMock.mockReset();
  peekThumbnailMock.mockReturnValue(null);
  getThumbnailMock.mockReturnValue(new Promise(() => {}));
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});
afterEach(() => vi.unstubAllGlobals());

describe("a remounted card with a known thumbnail", () => {
  it("paints it on the FIRST render, without waiting for an observer", () => {
    peekThumbnailMock.mockReturnValue({ kind: "markdown", html: "<p>cached</p>" });
    renderCard();

    // Present without any deliberate flushing. On the shipped regression this
    // was empty: the fetch waited on an observer that had not fired yet.
    expect(screen.getByTestId("gallery-card").innerHTML).toContain("cached");
  });

  // The load-bearing one: it is the only assertion here that can tell a read
  // during render from a read in an effect.
  it("arms no observer at all when there is nothing left to fetch", () => {
    peekThumbnailMock.mockReturnValue({ kind: "markdown", html: "<p>cached</p>" });
    renderCard();

    expect(FakeObserver.instances).toHaveLength(0);
  });

  it("does not re-request a thumbnail it already has", () => {
    peekThumbnailMock.mockReturnValue({ kind: "markdown", html: "<p>cached</p>" });
    renderCard();

    expect(getThumbnailMock).not.toHaveBeenCalled();
  });
});

describe("a card seeing a file for the first time", () => {
  it("still waits to be near the viewport before fetching", () => {
    // The prefetch must survive the fix: a cold folder still asks only for
    // rows the user is approaching, or a folder of five hundred files queues
    // five hundred jobs at a concurrency of two.
    renderCard();

    expect(getThumbnailMock).not.toHaveBeenCalled();
    expect(FakeObserver.instances).toHaveLength(1);
    expect(FakeObserver.instances[0].options?.rootMargin).toBe("100% 0px");
  });
});
