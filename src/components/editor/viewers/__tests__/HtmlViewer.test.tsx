// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HtmlViewer, buildHtmlViewerContent } from "../HtmlViewer";
import { PlainTextViewer } from "../PlainTextViewer";
import { useSettingsStore } from "@/stores/settings-store";

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

describe("HtmlViewer sandbox attribute — htmlViewerAllowForms", () => {
  const htmlContent = "<html><body><form action='/submit'><input type='submit'/></form></body></html>";
  const filePath = "/path/to/form.html";
  const fileName = "form.html";

  afterEach(() => {
    // Reset to default after each test so other tests are not affected
    useSettingsStore.setState({ htmlViewerAllowForms: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("excludes allow-forms and allow-top-navigation-by-user-activation by default (regression guard)", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-forms-default"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).not.toContain("allow-forms");
    expect(sandbox).not.toContain("allow-top-navigation-by-user-activation");
  });

  it("includes allow-forms in sandbox when htmlViewerAllowForms is true", () => {
    useSettingsStore.setState({ htmlViewerAllowForms: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-forms-on"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toContain("allow-forms");
  });

  it("includes allow-top-navigation-by-user-activation in sandbox when htmlViewerAllowForms is true", () => {
    useSettingsStore.setState({ htmlViewerAllowForms: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-forms-nav"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toContain("allow-top-navigation-by-user-activation");
  });

  it("still includes allow-same-origin when htmlViewerAllowForms is true (regression guard)", () => {
    useSettingsStore.setState({ htmlViewerAllowForms: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-forms-same-origin"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toContain("allow-same-origin");
  });
});

describe("HtmlViewer — buildHtmlViewerContent CSP injection", () => {
  it("returns content unchanged when blockExternalResources is false", () => {
    const content = "<html><body><img src='https://example.com/img.png'/></body></html>";
    const result = buildHtmlViewerContent(content, false);
    expect(result).toBe(content);
  });

  it("prepends a CSP meta tag when blockExternalResources is true", () => {
    const content = "<html><body><img src='https://example.com/img.png'/></body></html>";
    const result = buildHtmlViewerContent(content, true);
    expect(result).toContain("Content-Security-Policy");
    expect(result).toContain("http-equiv");
  });

  it("CSP meta tag comes before the original content when blocking", () => {
    const content = "<html><body>hello</body></html>";
    const result = buildHtmlViewerContent(content, true);
    const cspIndex = result.indexOf("Content-Security-Policy");
    const htmlIndex = result.indexOf("<html>");
    expect(cspIndex).toBeGreaterThanOrEqual(0);
    // CSP meta should appear before the original html tag OR be embedded inside it
    // (either prepended before, or injected into the <head>)
    expect(cspIndex).toBeLessThan(htmlIndex + result.indexOf("hello"));
  });

  it("CSP blocks external images, stylesheets, and fonts but allows inline and data URIs", () => {
    const content = "<html><body>test</body></html>";
    const result = buildHtmlViewerContent(content, true);
    // Should allow 'self', 'unsafe-inline', and data: while blocking external http
    const cspTagMatch = result.match(/content="([^"]+)"/i);
    expect(cspTagMatch).not.toBeNull();
    const cspValue = cspTagMatch![1];
    // Must not allow general https? origins
    expect(cspValue).not.toContain("https:");
    // Must allow same-origin or 'self' and inline
    expect(cspValue).toMatch(/'self'|data:/);
  });
});

describe("HtmlViewer — htmlViewerBlockExternalResources setting integration", () => {
  const htmlContent = "<html><body><img src='https://example.com/img.png'/></body></html>";
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("renders the iframe normally when blockExternalResources is false (regression guard)", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-off"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Sandbox stays the same — allow-same-origin, no allow-scripts
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toContain("allow-same-origin");
  });

  it("renders the iframe with sandbox when blockExternalResources is true", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-on"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Sandbox still has allow-same-origin; CSP is in the written content, not the attribute
    const sandbox = iframe!.getAttribute("sandbox");
    expect(sandbox).toContain("allow-same-origin");
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
