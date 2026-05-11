// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HtmlViewer } from "../HtmlViewer";
import { PlainTextViewer } from "../PlainTextViewer";
import { useSettingsStore } from "@/stores/settings-store";
import { setMockInvokeHandler } from "@/test/tauri-mock";

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

  it("renders the sanitised HTML body inline by default", () => {
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
    // The rendered surface is a sanitised inline div, not an iframe.
    // (PR rewrite: iframe forwarding caused Cmd+T / app shortcut breakage.)
    expect(document.querySelector("iframe")).toBeNull();
    // The body content should appear in the rendered surface.
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("strips scripts from rendered output (sanitisation)", () => {
    render(
      <HtmlViewer
        content="<html><body><h1>Title</h1><script>alert(1)</script></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-2"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // No <script> should make it through DOMPurify.
    expect(document.querySelector("script")).toBeNull();
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
    // Inline-rendered body is back, and the rendered text is visible.
    expect(screen.getByText("Hello")).toBeTruthy();
  });
});

describe("HtmlViewer form sanitisation — htmlViewerAllowForms", () => {
  const htmlContent =
    "<html><body><h1>Page</h1><form action='/submit'><input type='text' name='q'/><button type='submit'>Go</button></form></body></html>";
  const filePath = "/path/to/form.html";
  const fileName = "form.html";

  afterEach(() => {
    // Reset to default after each test so other tests are not affected
    useSettingsStore.setState({ htmlViewerAllowForms: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("strips <form> + form controls by default (regression guard)", () => {
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
    // Surrounding markup still renders — only the form subtree is gone.
    expect(screen.getByText("Page")).toBeTruthy();
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("input")).toBeNull();
    expect(document.querySelector("button[type='submit']")).toBeNull();
  });

  it("preserves <form> + form controls when htmlViewerAllowForms is true", () => {
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
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    // The action attribute must round-trip — that's the actual submit target.
    expect(form!.getAttribute("action")).toBe("/submit");
    const input = document.querySelector("input");
    expect(input).not.toBeNull();
    expect(input!.getAttribute("name")).toBe("q");
    expect(document.querySelector("button[type='submit']")).not.toBeNull();
  });

  it("still strips <script> when htmlViewerAllowForms is true (regression guard)", () => {
    useSettingsStore.setState({ htmlViewerAllowForms: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><form><input/></form><script>alert(1)</script></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-forms-script"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("form")).not.toBeNull();
  });
});

describe("PlainTextViewer routing for HTML files", () => {
  it("routes .html files to HtmlViewer (renders inline body, not code-editor)", () => {
    render(
      <PlainTextViewer
        content="<html><body><span>Hello</span></body></html>"
        fileName="index.html"
        filePath="/path/index.html"
        tabId="tab-html"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Inline-rendered body, not CodeEditor.
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });

  it("routes .htm files to HtmlViewer (renders inline body, not code-editor)", () => {
    render(
      <PlainTextViewer
        content="<html><body><span>Hello</span></body></html>"
        fileName="page.htm"
        filePath="/path/page.htm"
        tabId="tab-htm"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByText("Hello")).toBeTruthy();
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

describe("HtmlViewer allow-scripts mode — htmlViewerAllowScripts", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("when OFF (default): no iframe in the DOM (regression guard)", async () => {
    render(
      <HtmlViewer
        content="<html><body><h1>Safe</h1></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-scripts-off"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Default path: DOMPurify inline div, never an iframe.
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText("Safe")).toBeTruthy();
  });

  it("when ON: renders an iframe instead of the DOMPurify inline div", async () => {
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><h1>Unsafe</h1></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-scripts-on"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(document.querySelector("iframe")).not.toBeNull();
    });
  });

  it("when ON: iframe sandbox includes allow-scripts", async () => {
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><p>Scripts on</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-scripts-sandbox"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("sandbox")).toContain("allow-scripts");
    });
  });

  it("when ON: iframe sandbox does NOT include allow-same-origin (null-origin isolation)", async () => {
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><p>Isolated</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-scripts-isolation"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("sandbox")).not.toContain("allow-same-origin");
    });
  });

  it("when ON: same-directory <script src='./local.js'> is inlined via read_file", async () => {
    setMockInvokeHandler("read_file", (args) => {
      if ((args?.path as string | undefined)?.endsWith("local.js")) {
        return "console.log('local-script-executed');";
      }
      throw new Error("unexpected read_file call");
    });
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><h1>Page</h1><script src="./local.js"></script></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-scripts-inline-src"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
      expect(srcdoc).toContain("console.log('local-script-executed')");
    });
  });
});
