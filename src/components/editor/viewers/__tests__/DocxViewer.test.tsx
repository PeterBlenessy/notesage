// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock docx-preview
const mockRenderAsync = vi.fn();
vi.mock("docx-preview", () => ({
  renderAsync: (...args: unknown[]) => mockRenderAsync(...args),
}));

// Mock binary-cache
const mockGetBinaryData = vi.fn();
vi.mock("@/lib/binary-cache", () => ({
  getBinaryData: (path: string) => mockGetBinaryData(path),
}));

// Mock dom-search
vi.mock("@/lib/dom-search", () => ({
  highlightDomMatches: vi.fn(() => []),
  clearDomHighlights: vi.fn(),
}));

// Mock ResizeObserver (not available in jsdom)
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

import { DocxViewer } from "../DocxViewer";

describe("DocxViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRenderAsync.mockResolvedValue(undefined);
  });

  it("shows loading state while rendering", () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockRenderAsync.mockReturnValue(new Promise(() => {})); // never resolves

    render(
      <DocxViewer filePath="/test/doc.docx" fileName="doc.docx" />
    );

    expect(screen.getByText("Loading document...")).toBeTruthy();
  });

  it("shows error when no binary data available", async () => {
    mockGetBinaryData.mockReturnValue(null);

    render(
      <DocxViewer filePath="/test/missing.docx" fileName="missing.docx" />
    );

    await waitFor(() => {
      expect(screen.getByText("No DOCX data available")).toBeTruthy();
    });
  });

  it("calls renderAsync with correct options", async () => {
    const fakeData = new Uint8Array([1, 2, 3]);
    mockGetBinaryData.mockReturnValue(fakeData);

    render(
      <DocxViewer filePath="/test/doc.docx" fileName="doc.docx" />
    );

    await waitFor(() => {
      expect(mockRenderAsync).toHaveBeenCalledWith(
        fakeData.buffer,
        expect.any(HTMLDivElement),
        expect.anything(),
        expect.objectContaining({
          inWrapper: true,
          ignoreHeight: false,
          breakPages: true,
          renderHeaders: true,
          renderFooters: true,
          className: "docx-preview-body",
        })
      );
    });
  });

  it("hides loading state after successful render", async () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));

    render(
      <DocxViewer filePath="/test/doc.docx" fileName="doc.docx" />
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading document...")).toBeNull();
    });
  });

  it("shows error on renderAsync failure", async () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));
    mockRenderAsync.mockRejectedValue(new Error("Invalid DOCX"));

    render(
      <DocxViewer filePath="/test/bad.docx" fileName="bad.docx" />
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to render DOCX.*Invalid DOCX/)).toBeTruthy();
    });
  });

  it("renders floating ViewerToolbarPill with zoom controls", () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));

    render(
      <DocxViewer filePath="/test/doc.docx" fileName="doc.docx" />
    );

    // Pill is identifiable by its role=toolbar with the shared aria-label.
    const toolbar = screen.getByRole("toolbar", { name: "Viewer toolbar" });
    expect(toolbar).toBeTruthy();
    expect(toolbar.getAttribute("data-viewer-id")).toBe("docx");
    // Zoom in/out buttons live inside the pill.
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeTruthy();
    // Fit controls.
    expect(screen.getByRole("button", { name: "Fit to width" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fit to page" })).toBeTruthy();
    // Search toggle.
    expect(screen.getByRole("button", { name: "Find" })).toBeTruthy();
  });

  it("renders Convert to Markdown button when callback provided", () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));
    const onConvert = vi.fn();

    render(
      <DocxViewer
        filePath="/test/doc.docx"
        fileName="doc.docx"
        onConvertToMarkdown={onConvert}
      />
    );

    expect(screen.getByRole("button", { name: "Convert to Markdown" })).toBeTruthy();
  });

  it("calls onConvertToMarkdown with fileName when clicked", async () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));
    const onConvert = vi.fn();

    render(
      <DocxViewer
        filePath="/test/doc.docx"
        fileName="doc.docx"
        onConvertToMarkdown={onConvert}
      />
    );

    const button = screen.getByRole("button", { name: "Convert to Markdown" });
    button.click();

    expect(onConvert).toHaveBeenCalledWith("doc.docx");
  });

  it("does not render Convert to Markdown button without callback", () => {
    mockGetBinaryData.mockReturnValue(new Uint8Array([1, 2, 3]));

    render(
      <DocxViewer filePath="/test/doc.docx" fileName="doc.docx" />
    );

    expect(screen.queryByRole("button", { name: "Convert to Markdown" })).toBeNull();
  });
});
