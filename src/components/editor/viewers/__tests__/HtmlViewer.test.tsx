// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
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
    // There should be a source-view toggle button in rendered mode
    const toggleButton = screen.getByRole("button", { name: /switch to source view/i });
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

    // Click source toggle
    const toggleButton = screen.getByRole("button", { name: /switch to source view/i });
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
    fireEvent.click(screen.getByRole("button", { name: /switch to source view/i }));
    expect(screen.getByTestId("code-editor")).toBeTruthy();
    // Click the rendered-view button to return
    fireEvent.click(screen.getByRole("button", { name: /switch to rendered view/i }));
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

describe("HtmlViewer — Unsafe preview mode", () => {
  const htmlWithScript =
    '<html><body><h1>CDN App</h1><script src="https://cdn.example.com/lib.js"></script></body></html>';
  const fileName = "app.html";
  const filePath = "/path/to/app.html";

  // Unsafe-mode tests must run with the `htmlViewerAllowScripts` setting OFF
  // so the setting-driven iframe path doesn't preempt the toolbar-toggle path.
  // The setting is a sticky persisted value; reset before AND after each test.
  beforeEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });
  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  const defaultProps = {
    content: htmlWithScript,
    fileName,
    filePath,
    tabId: "tab-unsafe-1",
    isDirty: false,
    updateTabContent: vi.fn(),
    saveFileWithContent: vi.fn(),
  };

  it("renders an 'Unsafe preview mode' toggle button in the toolbar (default OFF)", () => {
    render(<HtmlViewer {...defaultProps} />);
    // The toggle must exist in the rendered-mode toolbar
    const toggle = screen.getByRole("button", { name: /unsafe preview/i });
    expect(toggle).toBeTruthy();
    // No iframe by default — DOMPurify safe mode is active
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("clicking the Unsafe preview toggle shows a security acknowledgment dialog", () => {
    render(<HtmlViewer {...defaultProps} />);
    const toggle = screen.getByRole("button", { name: /unsafe preview/i });
    fireEvent.click(toggle);
    // AlertDialog must appear with a recognisable warning
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    // Dialog must offer Accept and Cancel actions
    expect(screen.getByRole("button", { name: /accept|enable|confirm/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("accepting the dialog renders raw HTML in a sandboxed iframe (allow-scripts)", () => {
    render(<HtmlViewer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    // An iframe must replace the dangerouslySetInnerHTML div
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // sandbox must be exactly allow-scripts (no allow-same-origin)
    expect(iframe!.getAttribute("sandbox")).toBe("allow-scripts");
    // The raw HTML (including the CDN script tag) must be in srcdoc — not stripped
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("cdn.example.com");
    expect(srcdoc).toContain("CDN App");
  });

  it("cancelling the dialog keeps DOMPurify safe mode active — no iframe", () => {
    render(<HtmlViewer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // No iframe — DOMPurify path remains
    expect(document.querySelector("iframe")).toBeNull();
    // Scripts are still stripped
    expect(document.querySelector("script")).toBeNull();
  });

  it("unsafe mode resets to OFF when tabId changes (session-only)", () => {
    const { rerender } = render(<HtmlViewer {...defaultProps} tabId="tab-a" />);
    // Activate unsafe mode
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    expect(document.querySelector("iframe")).not.toBeNull();

    // Simulate tab switch by changing tabId
    rerender(<HtmlViewer {...defaultProps} tabId="tab-b" />);
    // Unsafe mode must reset — no iframe
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("DOMPurify path unchanged — script tags stripped when unsafe mode is OFF (regression guard)", () => {
    render(<HtmlViewer {...defaultProps} />);
    // No unsafe mode activation — safe path only
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
    // The non-script content is still rendered
    expect(screen.getByText("CDN App")).toBeTruthy();
  });

  it("unsafe mode iframe passes the full raw HTML content through without sanitisation", () => {
    const inlineScript =
      '<html><body><h1>Inline</h1><script>window._test = 42;</script></body></html>';
    render(<HtmlViewer {...defaultProps} content={inlineScript} />);
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Raw inline script is preserved in srcdoc
    expect(iframe!.getAttribute("srcdoc")).toContain("window._test = 42");
  });
});

describe("HtmlViewer — block external resources — htmlViewerBlockExternalResources", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  const defaultProps = {
    fileName,
    filePath,
    tabId: "tab-block-ext",
    isDirty: false,
    updateTabContent: vi.fn(),
    saveFileWithContent: vi.fn(),
  };

  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("when OFF (default): remote https:// img src passes through sanitisation unchanged", () => {
    render(
      <HtmlViewer
        {...defaultProps}
        content='<html><body><img src="https://example.com/img.png" alt="test"/></body></html>'
        tabId="tab-block-off"
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/img.png");
  });

  it("when ON: remote https:// img src is stripped before render", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        {...defaultProps}
        content='<html><body><img src="https://example.com/img.png" alt="test"/></body></html>'
        tabId="tab-block-https"
      />
    );
    const img = document.querySelector("img");
    // img element may still be in DOM but src attribute must be gone
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBeFalsy();
  });

  it("when ON: remote http:// img src is also stripped", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        {...defaultProps}
        content='<html><body><img src="http://example.com/img.png" alt="test"/></body></html>'
        tabId="tab-block-http"
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBeFalsy();
  });

  it("when ON: data: URI img src is preserved (not an external resource)", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    const dataUri = "data:image/png;base64,iVBORw0KGgo=";
    render(
      <HtmlViewer
        {...defaultProps}
        content={`<html><body><img src="${dataUri}" alt="test"/></body></html>`}
        tabId="tab-block-data"
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(dataUri);
  });

  it("when ON: relative path img src is preserved (not an external resource)", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        {...defaultProps}
        content='<html><body><img src="./images/photo.jpg" alt="test"/></body></html>'
        tabId="tab-block-rel"
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("./images/photo.jpg");
  });

  it("when ON: inline style attribute is preserved (not an external resource)", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        {...defaultProps}
        content='<html><body><p style="color:red">Hello</p></body></html>'
        tabId="tab-block-inline-style"
      />
    );
    const p = document.querySelector("p");
    expect(p).not.toBeNull();
    // inline style attribute must survive (it's not an external resource)
    expect(p!.getAttribute("style")).toContain("color");
    expect(screen.getByText("Hello")).toBeTruthy();
  });
});
