// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { renderWithProviders, screen } from "@/test/component-harness";
import { ArticleRow } from "@/components/mobile/ArticleRow";
import { useMobileStore } from "@/stores/mobile-store";

const getThumbnailMock = vi.fn();
vi.mock("@/lib/mobile-thumbnails", () => ({
  getThumbnail: (...args: unknown[]) => getThumbnailMock(...args),
}));

const toggle = vi.fn();
vi.mock("@/lib/speech-controller", () => ({
  toggleSpeech: (...args: unknown[]) => toggle(...args),
}));

const metaMock = vi.fn();
vi.mock("@/lib/article-meta-cache", () => ({
  articleMetaFor: (...args: unknown[]) => metaMock(...args),
}));

const noopActions = {
  isPinned: () => false,
  togglePin: async () => {},
};

const capture = {
  name: "How to read.html",
  path: "Inbox/How to read.html",
  is_directory: false,
  hidden: false,
  modified: 1_700_000_000,
};

beforeEach(() => {
  getThumbnailMock.mockReset();
  metaMock.mockReset();
  metaMock.mockResolvedValue({ title: "How to read", excerpt: "Slowly.", minutes: 4, site: "example.com" });
  getThumbnailMock.mockResolvedValue({ kind: "image", url: "blob:lead" });
  useMobileStore.setState({ readingProgress: {}, speech: null, openDoc: null });
  toggle.mockReset();
});

describe("ArticleRow layout (thumbnail left, 2026-09-04)", () => {
  it("puts the picture BEFORE the title, in the plain row's slot, 72pt at rest", async () => {
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByTestId("row-thumbnail")).toBeTruthy());
    const img = screen.getByTestId("row-thumbnail");
    const title = screen.getByText("How to read");
    // DOM order is reading order: the picture leads, like a FileRow's icon.
    expect(img.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("row-thumbnail-slot").className).toMatch(/h-\[4\.5rem\]/);
    expect(img.className).toMatch(/h-\[4\.5rem\]/);
    expect(screen.getByText("Slowly.")).toBeTruthy();
  });

  it("condensed: 40pt picture, no excerpt", async () => {
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed />);
    await waitFor(() => expect(screen.getByTestId("row-thumbnail")).toBeTruthy());
    expect(screen.getByTestId("row-thumbnail-slot").className).toMatch(/h-10/);
    expect(screen.getByTestId("row-thumbnail").className).not.toMatch(/4\.5rem/);
    expect(screen.queryByText("Slowly.")).toBeNull();
  });

  it("holds the slot with the file icon until the picture lands, so the title never shifts", async () => {
    let resolve: (v: unknown) => void = () => {};
    getThumbnailMock.mockReturnValue(new Promise((r) => (resolve = r)));
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    const slot = screen.getByTestId("row-thumbnail-slot");
    expect(slot.className).toMatch(/h-\[4\.5rem\]/);
    expect(slot.className).toMatch(/bg-muted/); // painted, not a hole
    expect(slot.querySelector("svg")).toBeTruthy();
    expect(screen.queryByTestId("row-thumbnail")).toBeNull();
    resolve({ kind: "image", url: "blob:late" });
    await waitFor(() => expect(screen.getByTestId("row-thumbnail")).toBeTruthy());
    expect(slot.querySelector("svg")).toBeNull();
  });

  it("falls back to the plain row for a file that is not a capture", async () => {
    metaMock.mockResolvedValue(null);
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read.html")).toBeTruthy());
  });

  it("the fallback row keeps the list's density (a plain .html stayed 72pt in a condensed list)", async () => {
    metaMock.mockResolvedValue(null);
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed />);
    await waitFor(() => expect(screen.getByText("How to read.html")).toBeTruthy());
    const slot = screen.getByTestId("row-thumbnail-slot");
    expect(slot.className).toMatch(/h-10/);
    expect(slot.className).not.toMatch(/4\.5rem/);
  });
});

describe("ArticleRow Listen control (2026-09-04)", () => {
  it("every article row has one; it starts playback in place and does not open the row", async () => {
    const onActivate = vi.fn();
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={onActivate} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Listen" }));
    expect(toggle).toHaveBeenCalledWith(expect.objectContaining({ path: capture.path }));
    expect(onActivate).not.toHaveBeenCalled();
    expect(useMobileStore.getState().openDoc).toBeNull();
  });

  it("the row itself is a real button whose name does not pick up the control's", async () => {
    const onActivate = vi.fn();
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={onActivate} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    const row = screen.getByRole("button", { name: /How to read/ });
    expect(row.tagName).toBe("BUTTON");
    expect(row.textContent).not.toContain("Listen");
    fireEvent.click(row);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe("ArticleRow swipe actions (2026-09-05)", () => {
  it("a saved article swipes to Share and Delete, exactly like the plain row", async () => {
    const { setMockInvokeHandler } = await import("@/test/component-harness");
    setMockInvokeHandler("ios_context_menu", () => "delete");
    let deleted: string | null = null;
    setMockInvokeHandler("ios_delete_file", (args) => {
      deleted = (args as { relPath: string }).relPath;
      return null;
    });
    const onPathRemoved = vi.fn();
    const onChanged = vi.fn();
    renderWithProviders(
      <ArticleRow
        actionContext={{ ...noopActions, onPathRemoved }}
        entry={capture}
        onActivate={() => {}}
        onChanged={onChanged}
        condensed={false}
      />,
    );
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    const row = screen.getByRole("button", { name: /How to read/ });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 0 });
    fireEvent.pointerMove(row, { clientX: 100, clientY: 0 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 0 });
    // Both actions, in the plain row's order — Delete edge-most.
    expect(screen.getByRole("button", { name: "Share" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onPathRemoved).toHaveBeenCalledWith(capture.path));
    expect(deleted).toBe(capture.path);
    expect(onChanged).toHaveBeenCalled();
  });

  it("keeps its Listen control while the actions are revealed", async () => {
    renderWithProviders(
      <ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed={false} />,
    );
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    const row = screen.getByRole("button", { name: /How to read/ });
    fireEvent.pointerDown(row, { clientX: 300, clientY: 0 });
    fireEvent.pointerMove(row, { clientX: 100, clientY: 0 });
    fireEvent.pointerUp(row, { clientX: 100, clientY: 0 });
    expect(screen.getByTestId("row-listen")).toBeTruthy();
  });
});

describe("unread is legible without a badge (2026-09-05)", () => {
  const inbox = { ...capture, path: "Inbox/How to read.html" };
  const weight = () => (screen.getByText("How to read") as HTMLElement).style.fontWeight;

  it("an unopened Inbox article carries the heavier title", async () => {
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={inbox} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    expect(weight()).toContain("600");
  });

  it("opening it settles the title back to normal weight", async () => {
    useMobileStore.setState({ inboxOpened: { [inbox.path]: true } });
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={inbox} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    expect(weight()).toContain("400");
    expect(weight()).not.toContain("600");
  });

  it("progress alone also counts as read, for state written before the flag existed", async () => {
    useMobileStore.setState({ readingProgress: { [inbox.path]: 0.2 } });
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={inbox} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    expect(weight()).not.toContain("600");
  });

  it("says nothing about documents outside the Inbox", async () => {
    renderWithProviders(<ArticleRow actionContext={noopActions} entry={capture} onActivate={() => {}} condensed={false} />);
    await waitFor(() => expect(screen.getByText("How to read")).toBeTruthy());
    expect(weight()).not.toContain("600");
  });
});
