// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { HtmlViewer } from "../HtmlViewer";
import { PlainTextViewer } from "../PlainTextViewer";
import { EditorViewerContainer } from "../../EditorViewerContainer";
import { useSettingsStore } from "@/stores/settings-store";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { fireZoom } from "@/hooks/useEditorZoom";

// jsdom doesn't implement scrollIntoView — mock it globally
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

// Mock CodeEditor to avoid full CodeMirror setup in jsdom
vi.mock("../CodeEditor", () => ({
  CodeEditor: ({ fileName, content }: { fileName: string; content: string }) => (
    <div data-testid="code-editor" data-filename={fileName}>
      {content}
    </div>
  ),
}));

// Mock StatusBar to avoid complex store dependencies when testing EditorViewerContainer
vi.mock("@/components/editor/StatusBar", () => ({
  StatusBar: ({ onToggleViewMode }: { onToggleViewMode?: () => void }) => (
    <button data-testid="status-toggle-view" onClick={onToggleViewMode}>
      Toggle View
    </button>
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

  it("renders CodeEditor when sourceMode prop is true", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-3"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
        sourceMode={true}
        onToggleSourceMode={vi.fn()}
      />
    );
    expect(screen.getByTestId("code-editor")).toBeTruthy();
  });

  it("renders HTML content when sourceMode prop is false", () => {
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-4"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
        sourceMode={false}
        onToggleSourceMode={vi.fn()}
      />
    );
    expect(screen.queryByTestId("code-editor")).toBeNull();
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("calls onToggleSourceMode when Rendered button is clicked in source mode", () => {
    const toggleFn = vi.fn();
    render(
      <HtmlViewer
        content={htmlContent}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-5"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
        sourceMode={true}
        onToggleSourceMode={toggleFn}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /switch to rendered view/i }));
    expect(toggleFn).toHaveBeenCalledOnce();
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

describe("HtmlViewer — block external resources — htmlViewerBlockExternalResources", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("when OFF (default): remote https:// img src passes through (regression guard)", () => {
    render(
      <HtmlViewer
        content='<html><body><img src="https://example.com/photo.jpg" alt="remote"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-off"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("https://example.com/photo.jpg");
  });

  it("when ON: remote https:// img src is stripped before render", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="https://example.com/photo.jpg" alt="remote"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-on-https"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    // src must be stripped (falsy or absent) — no remote fetch
    expect(img!.getAttribute("src")).toBeFalsy();
  });

  it("when ON: remote http:// img src is also stripped", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="http://example.com/photo.jpg" alt="remote http"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-on-http"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBeFalsy();
  });

  it("when ON: relative-path img src is preserved (only remote URIs stripped)", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="./images/photo.jpg" alt="local"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-rel-img"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe("./images/photo.jpg");
  });

  it("when ON: inline <style> blocks — DOMPurify strips <style> elements from body fragments by default (pre-existing behaviour, not our hook)", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><style>body { color: red; }</style><p>Styled</p></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-style"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Note: DOMPurify strips <style> elements from body fragments by default
    // (they are not in DOMPurify's safe-element list for fragment mode).
    // This is pre-existing behaviour introduced BEFORE this PR — the
    // `uponSanitizeAttribute` hook only processes attributes on elements that
    // survive the element-filter pass, so it does not change <style> handling.
    // The surrounding paragraph still renders correctly.
    expect(document.querySelector("style")).toBeNull();
    expect(screen.getByText("Styled")).toBeTruthy();
  });

  it("when ON: <link href=\"https://...\"> is absent — DOMPurify strips <link> elements by default (pre-existing behaviour, not our hook)", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><link href="https://cdn.example.com/style.css" rel="stylesheet"><p>No external CSS</p></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-link-https"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // DOMPurify strips <link> elements entirely (not in the safe-by-default allowlist).
    // Our hook would strip the href if <link> were allowed — but the element never reaches it.
    // Either way the remote stylesheet is NOT applied, which is the acceptance criterion.
    expect(document.querySelector("link")).toBeNull();
  });

  it("when ON: <link href=\"./styles.css\"> (relative path) is also absent — DOMPurify strips <link> by default", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><link href="./styles.css" rel="stylesheet"><p>Local CSS</p></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-ext-link-rel"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // DOMPurify strips <link> regardless of toggle state — the hook targets src/href/srcset
    // attribute values that begin with https?:, so a relative-path <link> href is NOT
    // affected by our hook even if the element were allowed. Both ON and OFF produce
    // no <link> element in the sanitised output (pre-existing DOMPurify behaviour).
    expect(document.querySelector("link")).toBeNull();
  });
});

describe("HtmlViewer — empty content placeholder", () => {
  const filePath = "/path/to/empty.html";
  const fileName = "empty.html";

  it("renders placeholder text when content is an empty string", () => {
    render(
      <HtmlViewer
        content=""
        fileName={fileName}
        filePath={filePath}
        tabId="tab-empty-string"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByText(/this html file is empty/i)).toBeTruthy();
  });

  it("renders placeholder text when content is whitespace-only", () => {
    render(
      <HtmlViewer
        content={"   \n\t  "}
        fileName={fileName}
        filePath={filePath}
        tabId="tab-empty-whitespace"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByText(/this html file is empty/i)).toBeTruthy();
  });

  it("shows file size (0 bytes) in the placeholder when content is empty", () => {
    render(
      <HtmlViewer
        content=""
        fileName={fileName}
        filePath={filePath}
        tabId="tab-empty-size"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByText(/0 bytes/i)).toBeTruthy();
  });

  it("does NOT render the placeholder when content has real HTML (regression guard)", () => {
    render(
      <HtmlViewer
        content="<html><body><p>Real content</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-non-empty"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.queryByText(/this html file is empty/i)).toBeNull();
    expect(screen.getByText("Real content")).toBeTruthy();
  });

  it("does NOT render the placeholder when content is minimal HTML (e.g. one <p>)", () => {
    render(
      <HtmlViewer
        content="<p>Hi</p>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-minimal-html"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.queryByText(/this html file is empty/i)).toBeNull();
    expect(screen.getByText("Hi")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// RED tests: blockExternal enforced on all render paths (currently broken)
// ---------------------------------------------------------------------------

describe("HtmlViewer — blockExternal enforced on allowScripts iframe path", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("blockExternal ON + allowScripts ON → external https:// img src stripped from iframe srcdoc", async () => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: true,
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="https://cdn.example.com/photo.jpg" alt="remote"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-scripts-https"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
      expect(srcdoc).not.toContain("https://cdn.example.com/photo.jpg");
    });
  });

  it("blockExternal ON + allowScripts ON → relative-path img src preserved in iframe srcdoc", async () => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: true,
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="./images/local.jpg" alt="local"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-scripts-rel"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
      expect(srcdoc).toContain("./images/local.jpg");
    });
  });
});

describe("HtmlViewer — blockExternal enforced on unsafe-preview iframe path", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  beforeEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });
  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("blockExternal ON + unsafeMode active → external https:// img src stripped from iframe srcdoc", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="https://cdn.example.com/photo.jpg" alt="remote"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-unsafe-https"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("https://cdn.example.com/photo.jpg");
  });

  it("blockExternal ON + unsafeMode active → relative-path img src preserved in iframe srcdoc", () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><img src="./images/local.jpg" alt="local"></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-block-unsafe-rel"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).toContain("./images/local.jpg");
  });
});

// ---------------------------------------------------------------------------
// RED test: forms render by default after allowForms toggle removal
// ---------------------------------------------------------------------------

describe("HtmlViewer — form renders by default (allowForms removed)", () => {
  const filePath = "/path/to/form.html";
  const fileName = "form.html";

  it("forms render in sanitised div without any toggle (regression guard)", () => {
    render(
      <HtmlViewer
        content="<html><body><form action='/submit'><input type='text' name='q'><button>Go</button></form></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-forms-default-render"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(document.querySelector("form")).not.toBeNull();
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

// ---------------------------------------------------------------------------
// RED tests — 10 correctness bugs identified in issue #375
// These tests must be RED (failing) before implementation and GREEN after.
// ---------------------------------------------------------------------------

// Bug 1: CSS url() in inline style attributes not stripped by stripExternalResources
describe("HtmlViewer — Bug 1: CSS url() in inline style not stripped when blockExternal ON", () => {
  beforeEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false, htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });
  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false, htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("blockExternal ON + unsafe preview: CSS url() in inline style is stripped from srcdoc", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><div style="background-image: url(https://evil.com/img.gif)">Content</div></body></html>'
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug1"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toMatch(/url\s*\(\s*https?:/i);
  });
});

// Bug 2 & 3: Additional HTML attributes (poster, action) not stripped
describe("HtmlViewer — Bug 2 & 3: poster and form action not stripped when blockExternal ON", () => {
  beforeEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false, htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });
  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false, htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("blockExternal ON + unsafe preview: video poster attribute is stripped from srcdoc", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><video poster="https://evil.com/thumb.jpg"></video></body></html>'
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug2-poster"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("https://evil.com/thumb.jpg");
  });

  it("blockExternal ON + unsafe preview: form action attribute is stripped from srcdoc", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><form action="https://evil.com/submit"><input type="submit" value="Go"></form></body></html>'
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug3-action"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc).not.toContain("https://evil.com/submit");
  });
});

// Bug 4: Find bar opens even when in iframe render mode (allowScripts or unsafeMode)
describe("HtmlViewer — Bug 4: Find bar opens in iframe modes when it should not", () => {
  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("notesage:find-open event does not open find bar when allowScripts iframe is active", async () => {
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><p>Hello</p></body></html>"
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug4"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    fireEvent(window, new Event("notesage:find-open"));
    expect(document.querySelector('input[aria-label="Find in document"]')).toBeNull();
  });
});

// Bug 5: htmlSourceMode not reset when switching between HTML tabs in EditorViewerContainer
describe("EditorViewerContainer — Bug 5: htmlSourceMode leaks across HTML tab switches", () => {
  const makeHtmlTab = (id: string) => ({
    id,
    filePath: `/path/${id}.html`,
    fileName: `${id}.html`,
    fileType: "other" as const,
    content: "<html><body><p>Hello</p></body></html>",
    isDirty: false,
  });

  it("htmlSourceMode resets to false when switching to a different HTML tab", () => {
    const tab1 = makeHtmlTab("evc-bug5-a");
    const tab2 = makeHtmlTab("evc-bug5-b");
    // updateTabContent and saveFile are required for PlainTextViewer to route to HtmlViewer
    const updateTabContent = vi.fn();
    const saveFile = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <EditorViewerContainer
        activeTab={tab1}
        focusMode={false}
        updateTabContent={updateTabContent}
        saveFile={saveFile}
      />
    );
    // Activate source mode via the mocked StatusBar toggle
    fireEvent.click(screen.getByTestId("status-toggle-view"));
    // Source mode ON — CodeEditor must be visible
    expect(screen.getByTestId("code-editor")).toBeTruthy();
    // Switch to a different tab
    rerender(
      <EditorViewerContainer
        activeTab={tab2}
        focusMode={false}
        updateTabContent={updateTabContent}
        saveFile={saveFile}
      />
    );
    // Source mode must have reset — no CodeEditor
    expect(screen.queryByTestId("code-editor")).toBeNull();
  });
});

// Bug 6: notesage:find-open event opens find bar even when unsafeMode (iframe) is active
describe("HtmlViewer — Bug 6: notesage:find-open opens find bar in unsafeMode", () => {
  beforeEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });
  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("notesage:find-open event does not open find bar when unsafeMode iframe is active", () => {
    render(
      <HtmlViewer
        content="<html><body><p>Hello</p></body></html>"
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug6"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Activate unsafe preview mode
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    // Now in unsafe iframe mode — fire find-open event
    fireEvent(window, new Event("notesage:find-open"));
    // Find bar must NOT open (useless/broken in iframe mode — renderRef is null)
    expect(document.querySelector('input[aria-label="Find in document"]')).toBeNull();
  });
});

// Bug 7: searchQuery state not cleared when content changes (reset effect is incomplete)
describe("HtmlViewer — Bug 7: searchQuery not cleared when content changes", () => {
  it("search query input is empty when find bar is reopened after content change", () => {
    const { rerender } = render(
      <HtmlViewer
        content="<html><body><p>Hello world</p></body></html>"
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug7"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Open find bar and type a query
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    const input = document.querySelector('input[aria-label="Find in document"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Hello" } });
    expect(input.value).toBe("Hello");
    // Change content — triggers the reset effect
    rerender(
      <HtmlViewer
        content="<html><body><p>Different content entirely</p></body></html>"
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug7"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Reopen find bar
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    const inputAfter = document.querySelector('input[aria-label="Find in document"]') as HTMLInputElement;
    // Query must be cleared — not the stale "Hello" from the previous file
    expect(inputAfter.value).toBe("");
  });
});

// Bug 8: zoom state not reset when tabId changes
describe("HtmlViewer — Bug 8: zoom not reset on tab switch", () => {
  afterEach(() => {
    // Reset the module-level zoom controller after each test
    act(() => { fireZoom("reset"); });
  });

  it("zoom resets to 1.0 (zoom indicator disappears) when tabId changes", () => {
    const commonProps = {
      content: "<html><body><p>Hello</p></body></html>",
      fileName: "page.html",
      filePath: "/path/page.html",
      isDirty: false,
      updateTabContent: vi.fn(),
      saveFileWithContent: vi.fn(),
    };
    const { rerender } = render(<HtmlViewer {...commonProps} tabId="tab-bug8-a" />);
    // Trigger zoom in via the registered viewer zoom controller
    act(() => { fireZoom("in"); });
    // Zoom indicator should be visible (non-1.0 zoom)
    expect(screen.getByText("110%")).toBeTruthy();
    // Switch to a different tab
    rerender(<HtmlViewer {...commonProps} tabId="tab-bug8-b" />);
    // Zoom must reset — zoom indicator should disappear
    expect(screen.queryByText("110%")).toBeNull();
  });
});

// Bug 9: DOCTYPE declaration dropped by stripExternalResources
describe("HtmlViewer — Bug 9: DOCTYPE dropped by stripExternalResources", () => {
  beforeEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false, htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });
  afterEach(() => {
    useSettingsStore.setState({ htmlViewerAllowScripts: false, htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("blockExternal ON + unsafe preview: DOCTYPE html is preserved in iframe srcdoc", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<!DOCTYPE html><html><body><img src="https://evil.com/img.jpg"></body></html>'
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug9"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    const srcdoc = iframe!.getAttribute("srcdoc") ?? "";
    expect(srcdoc.toLowerCase()).toContain("<!doctype");
  });
});

// Bug 10: Body extraction regex truncates on </body> inside HTML comments
describe("HtmlViewer — Bug 10: Body extraction truncates on </body> inside HTML comment", () => {
  it("renders content that appears after a comment containing </body>", () => {
    render(
      <HtmlViewer
        content="<html><body><!-- </body> --><p>After comment</p></body></html>"
        fileName="page.html"
        filePath="/path/page.html"
        tabId="tab-bug10"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByText("After comment")).toBeTruthy();
  });
});
