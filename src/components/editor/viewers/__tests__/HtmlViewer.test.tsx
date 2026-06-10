// @vitest-environment jsdom

// Radix Tooltip uses ResizeObserver via @radix-ui/react-use-size. jsdom doesn't
// ship one — polyfill before imports pull Radix in.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import "@/test/tauri-mock";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { HtmlViewer } from "../HtmlViewer";
import { PlainTextViewer } from "../PlainTextViewer";
import { EditorViewerContainer } from "../../EditorViewerContainer";
import { useSettingsStore } from "@/stores/settings-store";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { HTML_KEY_NS } from "../html-find-frame";

// Mock CodeEditor to avoid full CodeMirror setup in jsdom
vi.mock("../CodeEditor", () => ({
  CodeEditor: ({ fileName, content }: { fileName: string; content: string }) => (
    <div data-testid="code-editor" data-filename={fileName}>
      {content}
    </div>
  ),
}));

// The iframe render paths serve the document from the htmlpreview:// custom
// scheme so it renders under its own empty CSP (a blob:/srcdoc document inherits
// the app's hardened CSP and gets blanked). The frontend registers the HTML
// under a generated id via `html_preview_register`, then points the iframe at
// htmlpreview://localhost/<id>. Capture the registered content so tests can still
// assert on the processed HTML.
const registeredDocs: string[] = [];
/** Text of the most recent HTML registered for the iframe. */
async function lastIframeHtml(): Promise<string> {
  return registeredDocs[registeredDocs.length - 1] ?? "";
}
beforeEach(() => {
  registeredDocs.length = 0;
  setMockInvokeHandler("html_preview_register", (args) => {
    registeredDocs.push(String((args as { content?: string })?.content ?? ""));
    return undefined;
  });
  setMockInvokeHandler("html_preview_unregister", () => undefined);
});

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
      expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//);
    });
    expect(await lastIframeHtml()).toContain("console.log('local-script-executed')");
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
      expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//);
    });
    expect(await lastIframeHtml()).not.toContain("https://cdn.example.com/photo.jpg");
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
      expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//);
    });
    expect(await lastIframeHtml()).toContain("./images/local.jpg");
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

  it("blockExternal ON + unsafeMode active → external https:// img src stripped from iframe srcdoc", async () => {
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
    await waitFor(() => expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//));
    expect(await lastIframeHtml()).not.toContain("https://cdn.example.com/photo.jpg");
  });

  it("blockExternal ON + unsafeMode active → relative-path img src preserved in iframe srcdoc", async () => {
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
    await waitFor(() => expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//));
    expect(await lastIframeHtml()).toContain("./images/local.jpg");
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

  it("accepting the dialog renders raw HTML in a sandboxed iframe (allow-scripts)", async () => {
    render(<HtmlViewer {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    // An iframe must replace the dangerouslySetInnerHTML div
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // sandbox must be exactly allow-scripts (no allow-same-origin)
    expect(iframe!.getAttribute("sandbox")).toBe("allow-scripts");
    // Rendered from the htmlpreview:// scheme (own empty CSP), not srcdoc/blob.
    await waitFor(() => expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//));
    // The raw HTML (including the CDN script tag) must be passed through — not stripped
    const html = await lastIframeHtml();
    expect(html).toContain("cdn.example.com");
    expect(html).toContain("CDN App");
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

  it("unsafe mode iframe passes the full raw HTML content through without sanitisation", async () => {
    const inlineScript =
      '<html><body><h1>Inline</h1><script>window._test = 42;</script></body></html>';
    render(<HtmlViewer {...defaultProps} content={inlineScript} />);
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    // Raw inline script is preserved in the blob document
    expect(await lastIframeHtml()).toContain("window._test = 42");
  });
});

// ---------------------------------------------------------------------------
// RED tests: 10 bugs from v0.46.0 code review (issue #375)
// ---------------------------------------------------------------------------

// Bug 1a — blockExternal must strip CSS url() from inline style attributes
describe("HtmlViewer — Bug 1a: blockExternal strips CSS url() from inline style attributes", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("strips https:// url() from an element's inline style attribute when blockExternal ON", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><div style="background: url(https://evil.com/bg.jpg)">styled</div></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug1a-inline-style"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // The style attribute must not contain an external https:// url()
    const el = document.querySelector("[style]");
    // Either the element has no style attr or it has one with url() replaced
    if (el) {
      expect(el.getAttribute("style") ?? "").not.toContain("https://evil.com");
    }
    // Alternative: check rendered DOM directly
    expect(document.body.innerHTML).not.toContain("https://evil.com/bg.jpg");
  });
});

// Bug 1b — blockExternal must strip CSS url() from <style> blocks in iframe paths
describe("HtmlViewer — Bug 1b: blockExternal strips CSS url() from <style> blocks in iframe paths", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("allowScripts iframe: strips url(https://) from <style> block when blockExternal ON", async () => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: true,
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><head><style>body { background: url(https://evil.com/bg.jpg) }</style></head><body><p>page</p></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug1b-style-block-scripts"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//);
    });
    // The external url() must be stripped from the <style> block
    expect(await lastIframeHtml()).not.toContain("https://evil.com/bg.jpg");
  });

  it("unsafe-preview iframe: strips url(https://) from <style> block when blockExternal ON", async () => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><head><style>body { background: url(https://evil.com/bg.jpg) }</style></head><body><p>page</p></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug1b-style-block-unsafe"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    await waitFor(() => expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//));
    expect(await lastIframeHtml()).not.toContain("https://evil.com/bg.jpg");
  });
});

// Bugs 2 & 3 — blockExternal must strip poster/formaction/ping/action/data and
// forms with external action must not expose the action when blockExternal ON
describe("HtmlViewer — Bugs 2 & 3: blockExternal strips poster/formaction/ping/action/data attrs", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: false } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("strips poster attribute with external https:// URL when blockExternal ON", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><video poster="https://cdn.example.com/thumb.jpg"><source src="video.mp4"></video></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug2-poster"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // poster attr must be removed or replaced
    expect(document.body.innerHTML).not.toContain("https://cdn.example.com/thumb.jpg");
  });

  it("strips formaction attribute with external https:// URL when blockExternal ON", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><form><button type="submit" formaction="https://evil.com/submit">Go</button></form></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug2-formaction"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(document.body.innerHTML).not.toContain("https://evil.com/submit");
  });

  it("strips ping attribute with external https:// URL when blockExternal ON", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><a href="/local" ping="https://tracker.example.com/ping">link</a></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug2-ping"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(document.body.innerHTML).not.toContain("https://tracker.example.com/ping");
  });

  it("strips action attribute from form with external https:// URL when blockExternal ON (sanitised-div path)", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><form action="https://evil.com/submit"><input type="text" name="q"><button>Go</button></form></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug3-form-action"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // The form's action must not point to an external URL
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    const actionAttr = form!.getAttribute("action");
    expect(actionAttr ?? "").not.toMatch(/^https?:/);
  });

  it("strips data attribute with external https:// URL when blockExternal ON", () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<html><body><object data="https://evil.com/plugin.swf" type="application/x-shockwave-flash"></object></body></html>'
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug2-data"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(document.body.innerHTML).not.toContain("https://evil.com/plugin.swf");
  });
});

// Find (Cmd+F) opens in the iframe render modes and drives in-frame search via
// postMessage. (Was disabled by #377 when search couldn't reach the sandboxed
// cross-origin frame; restored once the viewer injects an in-frame find script.)
describe("HtmlViewer — Find opens in iframe render modes (in-frame search)", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("notesage:find-open opens the find bar when allowScripts iframe is active", async () => {
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><p>page</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-find-scripts"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(document.querySelector("iframe")).not.toBeNull();
    });
    act(() => {
      window.dispatchEvent(new Event("notesage:find-open"));
    });
    expect(screen.getByPlaceholderText(/find/i)).toBeTruthy();
  });

  it("Find toolbar button opens the find bar when allowScripts iframe is active", async () => {
    useSettingsStore.setState({ htmlViewerAllowScripts: true } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><p>page</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-find-btn-scripts"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      expect(document.querySelector("iframe")).not.toBeNull();
    });
    fireEvent.click(screen.getByRole("button", { name: /^find$/i }));
    expect(screen.getByPlaceholderText(/find/i)).toBeTruthy();
  });

  it("notesage:find-open opens the find bar when unsafe-preview iframe is active", () => {
    render(
      <HtmlViewer
        content="<html><body><p>page</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-find-unsafe"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    expect(document.querySelector("iframe")).not.toBeNull();

    act(() => {
      window.dispatchEvent(new Event("notesage:find-open"));
    });
    expect(screen.getByPlaceholderText(/find/i)).toBeTruthy();
  });
});

// Bug 5 — htmlSourceMode in EditorViewerContainer must reset on tab switch
describe("EditorViewerContainer — Bug 5: htmlSourceMode resets to false on tab switch", () => {
  it("resets htmlSourceMode to false when activeTab.id changes", async () => {
    const tab1 = {
      id: "tab-bug5-1",
      filePath: "/path/to/page.html",
      fileName: "page.html",
      fileType: "other" as const,
      content: "<html><body><p>Hello</p></body></html>",
      isDirty: false,
    };
    const tab2 = {
      id: "tab-bug5-2",
      filePath: "/path/to/other.html",
      fileName: "other.html",
      fileType: "other" as const,
      content: "<html><body><p>World</p></body></html>",
      isDirty: false,
    };

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

    // Verify rendered mode is active (no CodeEditor)
    expect(screen.queryByTestId("code-editor")).toBeNull();

    // The view-mode toggle is inside the StatusTray popover.
    // Open the status tray first, then click the toggle.
    const trayTrigger = screen.getByRole("button", { name: /open status tray/i });
    fireEvent.click(trayTrigger);

    // The toggle switch appears in the popover content (portal-mounted)
    const sourceBtn = await screen.findByRole("switch", { name: /switch to markdown source/i });
    fireEvent.click(sourceBtn);

    // Verify source mode is now active (CodeEditor visible)
    await waitFor(() => {
      expect(screen.getByTestId("code-editor")).toBeTruthy();
    });

    // Simulate switching to a different tab
    rerender(
      <EditorViewerContainer
        activeTab={tab2}
        focusMode={false}
        updateTabContent={updateTabContent}
        saveFile={saveFile}
      />
    );

    // Source mode must have reset — no CodeEditor
    await waitFor(() => {
      expect(screen.queryByTestId("code-editor")).toBeNull();
    });
  });
});

// Bug 6 — Search state (counter, DOM nodes) must reset on unsafeMode toggle.
// The find bar UI and the unsafe-preview toggle are mutually exclusive in the
// toolbar: find bar replaces the normal toolbar buttons. We close the find bar
// first, activate unsafe mode, then confirm find re-opens (now works in-frame)
// with fresh state (no stale match counter).
describe("HtmlViewer — Bug 6: search state resets on unsafeMode toggle", () => {
  it("find resets on unsafeMode toggle and re-opens (in-frame) afterwards", () => {
    const filePath = "/path/to/page.html";
    const fileName = "page.html";
    render(
      <HtmlViewer
        content="<html><body><p>Hello World</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug6-search-reset"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Open find bar via event
    act(() => {
      window.dispatchEvent(new Event("notesage:find-open"));
    });
    expect(screen.getByPlaceholderText(/find/i)).toBeTruthy();

    // Close find bar via the X button (find bar and unsafe toggle are mutually
    // exclusive in the toolbar — must close find bar before accessing toggle)
    fireEvent.click(screen.getByRole("button", { name: /close find/i }));
    expect(screen.queryByPlaceholderText(/find/i)).toBeNull();

    // Activate unsafeMode — this changes unsafeMode state, triggering the reset effect
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    expect(document.querySelector("iframe")).not.toBeNull();

    // In unsafe (iframe) mode, find-open now re-opens the bar — search runs
    // in-frame via postMessage — with fresh state (no stale match counter).
    act(() => {
      window.dispatchEvent(new Event("notesage:find-open"));
    });
    expect(screen.getByPlaceholderText(/find/i)).toBeTruthy();
    expect(screen.queryByText(/\d+\/\d+/)).toBeNull();
  });
});

// Bug 7 — searchQuery must be cleared when content changes
describe("HtmlViewer — Bug 7: searchQuery cleared when content changes", () => {
  it("searchQuery is cleared when content changes while find bar is open", () => {
    const filePath = "/path/to/page.html";
    const fileName = "page.html";
    const { rerender } = render(
      <HtmlViewer
        content="<html><body><p>Original</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug7-searchquery"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Open the find bar and type a query
    act(() => {
      window.dispatchEvent(new Event("notesage:find-open"));
    });
    const input = screen.getByPlaceholderText(/find/i);
    fireEvent.change(input, { target: { value: "Original" } });
    expect((input as HTMLInputElement).value).toBe("Original");

    // Simulate content change (rerender with new content)
    rerender(
      <HtmlViewer
        content="<html><body><p>Updated content</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug7-searchquery"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );

    // Find bar should be closed (search resets on content change)
    // searchQuery must be cleared — no stale query text
    expect(screen.queryByPlaceholderText(/find/i)).toBeNull();
  });
});

// Bug 8 — Zoom level must reset on tab switch (not leak across files)
describe("HtmlViewer — Bug 8: zoom level resets on tab/file switch", () => {
  it("zoom resets to 1.0 (no zoom indicator) when tabId changes", () => {
    const filePath = "/path/to/page.html";
    const fileName = "page.html";
    const { rerender } = render(
      <HtmlViewer
        content="<html><body><p>Page</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId="tab-bug8-zoom-a"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // There should be no zoom indicator (zoom = 1.0 shows no indicator)
    expect(screen.queryByText(/100%/i)).toBeNull();

    // Simulate zooming via keyboard shortcut (Cmd+=)
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true, bubbles: true }));
    });
    // Zoom indicator might now be visible OR not, depending on registration
    // Either way, switch tab and verify zoom reset

    // Switch to a different tab
    rerender(
      <HtmlViewer
        content="<html><body><p>Other page</p></body></html>"
        fileName="other.html"
        filePath="/path/to/other.html"
        tabId="tab-bug8-zoom-b"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );

    // After tab switch, zoom must be reset to 1.0 — no zoom indicator
    expect(screen.queryByText(/\d+%/)).toBeNull();
  });
});

// Bug 9 — stripExternalResources must preserve the DOCTYPE declaration
describe("HtmlViewer — Bug 9: stripExternalResources preserves DOCTYPE", () => {
  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
      htmlViewerBlockExternalResources: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  it("allowScripts iframe srcdoc retains DOCTYPE when blockExternal ON", async () => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: true,
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<!DOCTYPE html><html><head></head><body><p>Page</p></body></html>'
        fileName="page.html"
        filePath="/path/to/page.html"
        tabId="tab-bug9-doctype-scripts"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    await waitFor(() => {
      const iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//);
    });
    // DOCTYPE must be preserved in the blob document
    expect((await lastIframeHtml()).toLowerCase()).toContain("<!doctype html>");
  });

  it("unsafe-preview iframe srcdoc retains DOCTYPE when blockExternal ON", async () => {
    useSettingsStore.setState({
      htmlViewerBlockExternalResources: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content='<!DOCTYPE html><html><head></head><body><p>Page</p></body></html>'
        fileName="page.html"
        filePath="/path/to/page.html"
        tabId="tab-bug9-doctype-unsafe"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /unsafe preview/i }));
    fireEvent.click(screen.getByRole("button", { name: /accept|enable|confirm/i }));
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    await waitFor(() => expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//));
    expect((await lastIframeHtml()).toLowerCase()).toContain("<!doctype html>");
  });
});

// Bug 10 — Body extraction must handle </body> inside <pre> or HTML comments
describe("HtmlViewer — Bug 10: body extraction handles false </body>", () => {
  it("renders content after </body> inside <pre> correctly (non-greedy regex truncation)", () => {
    const tricky =
      "<html><body><pre>Some code </body> end</pre><p>After pre</p></body></html>";
    render(
      <HtmlViewer
        content={tricky}
        fileName="page.html"
        filePath="/path/to/page.html"
        tabId="tab-bug10-pre"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    // Both the <pre> content AND the <p> after it must render
    expect(screen.getByText("After pre")).toBeTruthy();
  });

  it("renders content correctly when </body> appears inside an HTML comment", () => {
    const tricky =
      "<html><body><!-- closing: </body> --><p>Real content</p></body></html>";
    render(
      <HtmlViewer
        content={tricky}
        fileName="page.html"
        filePath="/path/to/page.html"
        tabId="tab-bug10-comment"
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    expect(screen.getByText("Real content")).toBeTruthy();
  });
});

describe("HtmlViewer — keyboard chord forwarding from the sandboxed frame", () => {
  const filePath = "/path/to/page.html";
  const fileName = "page.html";

  afterEach(() => {
    useSettingsStore.setState({
      htmlViewerAllowScripts: false,
    } as Parameters<typeof useSettingsStore.setState>[0]);
  });

  async function mountIframe(tabId: string): Promise<HTMLIFrameElement> {
    useSettingsStore.setState({
      htmlViewerAllowScripts: true,
    } as Parameters<typeof useSettingsStore.setState>[0]);
    render(
      <HtmlViewer
        content="<html><body><p>x</p></body></html>"
        fileName={fileName}
        filePath={filePath}
        tabId={tabId}
        isDirty={false}
        updateTabContent={vi.fn()}
        saveFileWithContent={vi.fn()}
      />
    );
    let iframe: HTMLIFrameElement | null = null;
    await waitFor(() => {
      iframe = document.querySelector("iframe");
      expect(iframe).not.toBeNull();
      expect(iframe!.getAttribute("src")).toMatch(/^htmlpreview:\/\//);
    });
    return iframe!;
  }

  it("re-dispatches a chord forwarded from the iframe as a window keydown", async () => {
    const iframe = await mountIframe("tab-key-forward");
    const received: KeyboardEvent[] = [];
    const onKey = (e: KeyboardEvent) => received.push(e);
    window.addEventListener("keydown", onKey);
    try {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          data: {
            ns: HTML_KEY_NS,
            key: "k",
            code: "KeyK",
            metaKey: true,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
          },
        })
      );
      await waitFor(() => expect(received.some((e) => e.key === "k")).toBe(true));
      const evt = received.find((e) => e.key === "k")!;
      expect(evt.metaKey).toBe(true);
      expect(evt.code).toBe("KeyK");
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });

  it("ignores a forwarded-chord message whose source is not the iframe", async () => {
    await mountIframe("tab-key-spoof");
    const received: KeyboardEvent[] = [];
    const onKey = (e: KeyboardEvent) => received.push(e);
    window.addEventListener("keydown", onKey);
    try {
      // No `source` → fails the e.source === iframe.contentWindow guard.
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            ns: HTML_KEY_NS,
            key: "k",
            code: "KeyK",
            metaKey: true,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
          },
        })
      );
      await new Promise((r) => setTimeout(r, 20));
      expect(received.some((e) => e.key === "k")).toBe(false);
    } finally {
      window.removeEventListener("keydown", onKey);
    }
  });
});
