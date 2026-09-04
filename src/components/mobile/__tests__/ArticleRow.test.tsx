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
