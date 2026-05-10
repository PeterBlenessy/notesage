// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HtmlViewer } from "../HtmlViewer";
import { PlainTextViewer } from "../PlainTextViewer";

// Mock CodeEditor to avoid full CodeMirror setup in jsdom
vi.mock("../CodeEditor", () => ({
  CodeEditor: ({ fileName, content }: { fileName: string; content: string }) => (
    <div data-testid="code-editor" data-filename={fileName}>
      {content}
    </div>
  ),
}));

describe("HtmlViewer", () => {
  const htmlContent = "<html><body><h1>Hello</h1></body></html>";
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  it("renders an iframe in rendered mode by default", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-1"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Should show an iframe for rendered mode
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
  });

  it("iframe has sandbox='allow-same-origin' without allow-scripts", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-2"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
  });

  it("shows a toggle button to switch between rendered and source modes", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-3"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // There should be a toggle button
    const toggleButton = screen.getByRole("button", { name: /source|rendered|code|preview/i });
    expect(toggleButton).toBeTruthy();
  });

  it("clicking toggle switches to source (CodeEditor) mode", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-4"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Initially in rendered mode — no code editor
    expect(screen.queryByTestId("code-editor")).toBeNull();

    // Click toggle to source mode
    const toggleButton = screen.getByRole("button", { name: /source|rendered|code|preview/i });
    fireEvent.click(toggleButton);

    // Should now show CodeEditor
    expect(screen.getByTestId("code-editor")).toBeTruthy();
  });

  it("clicking toggle again returns to rendered mode", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-5"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Click to enter source mode
    fireEvent.click(screen.getByRole("button", { name: /source|rendered|code|preview/i }));
    expect(screen.getByTestId("code-editor")).toBeTruthy();
    // Click again to return to rendered mode (re-query the new button)
    fireEvent.click(screen.getByRole("button", { name: /source|rendered|code|preview/i }));
    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(document.querySelector("iframe")).not.toBeNull();
  });
});

describe("PlainTextViewer routing for HTML files", () => {
  it("routes .html files to HtmlViewer (shows iframe, not code-editor)", () => {
    render(
      <PlainTextViewer
        content="<html><body>Hello</body></html>"
        fileName="index.html"
        filePath="/path/index.html"
        tabId="tab-html"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Should show iframe (HtmlViewer rendered mode), not CodeEditor
    expect(document.querySelector("iframe")).not.toBeNull();
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });

  it("routes .htm files to HtmlViewer (shows iframe, not code-editor)", () => {
    render(
      <PlainTextViewer
        content="<html><body>Hello</body></html>"
        fileName="page.htm"
        filePath="/path/page.htm"
        tabId="tab-htm"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(document.querySelector("iframe")).not.toBeNull();
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });

  it("still routes .ts files to CodeEditor", () => {
    render(
      <PlainTextViewer
        content="const x = 1;"
        fileName="main.ts"
        filePath="/path/main.ts"
        tabId="tab-ts"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByTestId("code-editor")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });
});
