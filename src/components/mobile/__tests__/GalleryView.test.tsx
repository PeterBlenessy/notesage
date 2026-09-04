// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import type { FileEntry } from "@/lib/tauri";
import { GalleryView } from "@/components/mobile/GalleryView";

/** Minimal long-press action context (#680) — these suites cover rendering
 *  and activation, not the menu; the menu has its own suite. */
const noopActions = {
  isPinned: () => false,
  togglePin: async () => {},
};


const getThumbnailMock = vi.fn();
vi.mock("@/lib/mobile-thumbnails", () => ({
  getThumbnail: (...args: unknown[]) => getThumbnailMock(...args),
  cancelPendingThumbnails: vi.fn(),
}));

/** A controllable fake — real WKWebView has IntersectionObserver; jsdom does
 *  not, so the lazy-load behavior needs a manual trigger to test. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((o) => o !== el);
  }
  disconnect() {
    this.observed = [];
  }
  trigger(el: Element, isIntersecting: boolean) {
    this.callback(
      [{ target: el, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

function entry(overrides: Partial<FileEntry> & { name: string }): FileEntry {
  return {
    path: overrides.name,
    is_directory: false,
    hidden: false,
    ...overrides,
  };
}

beforeEach(() => {
  getThumbnailMock.mockReset();
  getThumbnailMock.mockResolvedValue({ kind: "icon" });
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GalleryView (#633)", () => {
  it("renders a 3-column grid with title, modified date, and containing folder for files", () => {
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[
          entry({ name: "note.md", modified: new Date(2026, 0, 5, 10, 0).getTime() / 1000 }),
        ]}
        currentFolderName="Ideas"
        theme="light"
        onActivate={() => {}}
      />,
    );

    const grid = screen.getByRole("list", { name: "Notes gallery" });
    expect(grid.className).toMatch(/grid-cols-3/);
    expect(screen.getByText("note.md")).toBeTruthy();
    expect(screen.getByText(/Ideas/)).toBeTruthy();
  });

  it("condensed packs four cards across with a one-line caption (2026-09-04)", () => {
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[
          entry({ name: "note.md", modified: new Date(2026, 0, 5, 10, 0).getTime() / 1000 }),
        ]}
        currentFolderName="Ideas"
        theme="light"
        onActivate={() => {}}
        condensed
      />,
    );
    const grid = screen.getByRole("list", { name: "Notes gallery" });
    expect(grid.className).toMatch(/grid-cols-4/);
    expect(grid.className).not.toMatch(/grid-cols-3/);
    expect(screen.getByText("note.md")).toBeTruthy();
    // The date · folder line is what would wrap at a quarter of the width.
    expect(screen.queryByText(/Ideas/)).toBeNull();
  });

  it("puts a Listen badge on saved pages only, and it does not open the card", () => {
    const onActivate = vi.fn();
    const onListen = vi.fn();
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[entry({ name: "story.html" }), entry({ name: "note.md" })]}
        currentFolderName="Inbox"
        theme="light"
        onActivate={onActivate}
        onListen={onListen}
      />,
    );
    const badges = screen.getAllByRole("button", { name: "Listen" });
    expect(badges).toHaveLength(1);
    fireEvent.click(badges[0]);
    expect(onListen).toHaveBeenCalledWith(expect.objectContaining({ name: "story.html" }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("renders directory cards without a modified/folder line", () => {
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[entry({ name: "Sub", path: "Sub", is_directory: true })]}
        currentFolderName="Notesage"
        theme="light"
        onActivate={() => {}}
      />,
    );
    expect(screen.getByText("Sub")).toBeTruthy();
    expect(screen.queryByText(/Notesage/)).toBeNull();
  });

  it("does not request a thumbnail for a card that has not become visible", () => {
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[entry({ name: "note.md" })]}
        currentFolderName="Ideas"
        theme="light"
        onActivate={() => {}}
      />,
    );
    expect(getThumbnailMock).not.toHaveBeenCalled();
  });

  it("requests a thumbnail once a card becomes visible, and only that card", () => {
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[entry({ name: "a.md" }), entry({ name: "b.md" })]}
        currentFolderName="Ideas"
        theme="light"
        onActivate={() => {}}
      />,
    );

    // Each card owns its own observer instance (lazy per-card, not a single
    // shared one) — find the instance watching the "a.md" card specifically.
    expect(FakeIntersectionObserver.instances).toHaveLength(2);
    const aCardEl = screen.getByText("a.md").closest("[data-testid=\"gallery-card\"]")!;
    const observerForA = FakeIntersectionObserver.instances.find((o) =>
      o.observed.includes(aCardEl),
    )!;
    expect(observerForA).toBeTruthy();
    observerForA.trigger(aCardEl, true);

    expect(getThumbnailMock).toHaveBeenCalledTimes(1);
    expect(getThumbnailMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "a.md" }),
      { theme: "light" },
    );
  });

  it("never requests a thumbnail for a directory card, even once visible", () => {
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[entry({ name: "Sub", path: "Sub", is_directory: true })]}
        currentFolderName="Notesage"
        theme="light"
        onActivate={() => {}}
      />,
    );
    const [observer] = FakeIntersectionObserver.instances;
    if (observer && observer.observed.length > 0) {
      observer.trigger(observer.observed[0], true);
    }
    expect(getThumbnailMock).not.toHaveBeenCalled();
  });

  it("tapping a card calls onActivate with that entry", () => {
    const onActivate = vi.fn();
    renderWithProviders(
      <GalleryView
        actionContext={noopActions}
        entries={[entry({ name: "note.md" })]}
        currentFolderName="Ideas"
        theme="light"
        onActivate={onActivate}
      />,
    );
    fireEvent.click(screen.getByText("note.md"));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ name: "note.md" }));
  });
});
