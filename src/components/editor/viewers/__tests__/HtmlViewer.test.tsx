// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { setMockInvokeHandler, clearMockInvokeHandlers } from "@/test/tauri-mock";
import { HtmlViewer } from "../HtmlViewer";

// Mock @tauri-apps/plugin-dialog
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(async () => null),
}));

// Mock window.matchMedia for theme detection
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

describe("HtmlViewer", () => {
  beforeEach(() => {
    clearMockInvokeHandlers();
  });

  it("renders loading state initially", () => {
    setMockInvokeHandler("render_html", () => new Promise(() => {})); // never resolves
    render(
      <HtmlViewer
        content="# Hello"
        filePath="/test/hello.md"
        fileName="hello.md"
      />
    );
    expect(screen.getByText("Rendering HTML...")).toBeTruthy();
  });

  it("renders iframe with srcdoc after render_html resolves", async () => {
    const mockHtml = "<html><body><h1>Hello</h1></body></html>";
    setMockInvokeHandler("render_html", () => mockHtml);

    render(
      <HtmlViewer
        content="# Hello"
        filePath="/test/hello.md"
        fileName="hello.md"
      />
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("srcdoc")).toBe(mockHtml);
    });
  });

  it("renders toolbar with Copy HTML and Export buttons", async () => {
    setMockInvokeHandler("render_html", () => "<html></html>");

    render(
      <HtmlViewer
        content="# Test"
        filePath="/test/test.md"
        fileName="test.md"
      />
    );

    expect(screen.getByText("HTML Preview")).toBeTruthy();
    expect(screen.getByText("Copy HTML")).toBeTruthy();
    expect(screen.getByText("Export")).toBeTruthy();
  });

  it("shows error state when render_html fails", async () => {
    setMockInvokeHandler("render_html", () => {
      throw new Error("Rendering failed");
    });

    render(
      <HtmlViewer
        content="# Error"
        filePath="/test/error.md"
        fileName="error.md"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to render HTML/)).toBeTruthy();
    });
  });

  it("passes correct parameters to render_html", async () => {
    const renderSpy = vi.fn(() => "<html></html>");
    setMockInvokeHandler("render_html", renderSpy);

    render(
      <HtmlViewer
        content="# Doc"
        filePath="/project/doc.md"
        fileName="doc.md"
        projectRoot="/project"
      />
    );

    await waitFor(() => {
      expect(renderSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          markdown: "# Doc",
          title: "doc",
          includeStyles: true,
          projectRoot: "/project",
        })
      );
    });
  });

  it("uses sandbox attribute on iframe", async () => {
    setMockInvokeHandler("render_html", () => "<html></html>");

    render(
      <HtmlViewer
        content="# Secure"
        filePath="/test/secure.md"
        fileName="secure.md"
      />
    );

    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe?.getAttribute("sandbox")).toBe("allow-same-origin");
    });
  });
});
