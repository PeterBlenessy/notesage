// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  renderWithProviders,
  screen,
  waitFor,
  fireEvent,
  setMockInvokeHandler,
} from "@/test/component-harness";
import { useMobileStore } from "@/stores/mobile-store";
import { LibraryBrowser } from "@/components/mobile/LibraryBrowser";
import { Reader } from "@/components/mobile/Reader";
import { Onboarding } from "@/components/mobile/Onboarding";

// pdf.js needs browser globals (DOMMatrix) absent in jsdom; the Reader
// lazy-loads the viewer, so stub it to assert routing without rendering pdf.js.
vi.mock("@/components/editor/viewers/PdfViewer", () => ({
  PdfViewer: ({ fileName }: { fileName: string }) => <div>pdf-viewer:{fileName}</div>,
}));

/** Mirrors MobileApp's screen switch without ThemeProvider (avoids matchMedia). */
function Shell() {
  const openDoc = useMobileStore((s) => s.openDoc);
  return openDoc ? <Reader /> : <LibraryBrowser />;
}

const invokeMock = vi.mocked(invoke);
const calledCommands = () => invokeMock.mock.calls.map((c) => c[0] as string);

/** Commands the read-only mobile shell is allowed to invoke. */
const ALLOWED = new Set([
  "ios_get_library_grant",
  "ios_pick_library_folder",
  "ios_clear_library_grant",
  "ios_list_directory",
  "ios_read_file",
  "ios_read_binary",
  "ios_ensure_downloaded",
  // Pure render — takes markdown text, returns an HTML fragment. Touches no
  // filesystem and no library path, so it cannot widen the read surface.
  "render_markdown_fragment",
]);

/** Commands that would mutate the library or reach AI — must never be invoked. */
const FORBIDDEN = [
  "ios_write_capture",
  "write_file",
  "delete_path",
  "create_file",
  "rename_path",
  "ai_chat_stream",
  "ai_chat",
];

beforeEach(() => {
  useMobileStore.getState().reset();
  invokeMock.mockClear();
  useMobileStore.setState({ grantState: "granted", libraryName: "Notesage" });
});

describe("mobile read-only browse → read flow", () => {
  it("lists the library and opens a markdown note rendered", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "Sub", path: "Sub", is_directory: true, hidden: false },
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "---\ntitle: T\n---\n\n# Hello Mobile\n\nBody text.");
    // Markdown is rendered by the Rust (comrak) pipeline, the same one the
    // desktop preview uses — including stripping frontmatter. The mock stands
    // in for that command; the real stripping is covered in preview.rs.
    setMockInvokeHandler(
      "render_markdown_fragment",
      () => "<h1>Hello Mobile</h1>\n<p>Body text.</p>",
    );

    renderWithProviders(<Shell />);

    const fileRow = await screen.findByText("note.md");
    fireEvent.click(fileRow);

    // Reader renders the markdown heading (frontmatter stripped).
    expect(await screen.findByText("Hello Mobile")).toBeTruthy();
    // The raw frontmatter must not leak into the rendered view.
    expect(screen.queryByText(/title: T/)).toBeNull();
  });

  it("only invokes allowed read commands — never a write/AI command", async () => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: "note.md", path: "note.md", is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler("ios_read_file", () => "# Hi");
    setMockInvokeHandler("render_markdown_fragment", () => "<h1>Hi</h1>");

    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText("note.md"));
    await screen.findByText("Hi");

    const cmds = calledCommands();
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(ALLOWED.has(cmd)).toBe(true);
    }
    for (const forbidden of FORBIDDEN) {
      expect(cmds).not.toContain(forbidden);
    }
  });
});

describe("library browser states", () => {
  it("shows an empty state for an empty folder", async () => {
    setMockInvokeHandler("ios_list_directory", () => []);
    renderWithProviders(<LibraryBrowser />);
    expect(await screen.findByText("Nothing here yet")).toBeTruthy();
  });

  it("shows an error state with retry when listing fails", async () => {
    setMockInvokeHandler("ios_list_directory", () => {
      throw new Error("boom");
    });
    renderWithProviders(<LibraryBrowser />);
    expect(await screen.findByText("Couldn't open this folder")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("reader states", () => {
  it("routes PDFs to the PDF viewer (reads bytes, not the unsupported state)", async () => {
    useMobileStore.setState({ openDoc: { relPath: "doc.pdf", name: "doc.pdf" } });
    // The wire format is base64 (a Vec<u8> would cross IPC as a JSON number
    // array — see iosReadBinary).
    setMockInvokeHandler("ios_read_binary", () => btoa("%PDF-1.4"));
    renderWithProviders(<Reader />);
    expect(await screen.findByText("pdf-viewer:doc.pdf")).toBeTruthy();
    expect(calledCommands()).toContain("ios_read_binary");
    // It must NOT fall back to the unsupported message for PDF.
    expect(screen.queryByText("Can't preview this format yet")).toBeNull();
  });

  it("shows an unsupported state for other binary formats (DOCX)", async () => {
    useMobileStore.setState({ openDoc: { relPath: "doc.docx", name: "doc.docx" } });
    renderWithProviders(<Reader />);
    expect(await screen.findByText("Can't preview this format yet")).toBeTruthy();
  });

  it("offers an iCloud download when the file isn't local yet", async () => {
    useMobileStore.setState({ openDoc: { relPath: "note.md", name: "note.md" } });
    setMockInvokeHandler("ios_read_file", () => {
      throw new Error("not downloaded");
    });
    setMockInvokeHandler("ios_ensure_downloaded", () => "downloading");
    renderWithProviders(<Reader />);
    expect(await screen.findByText("Downloading from iCloud")).toBeTruthy();
  });
});

describe("onboarding", () => {
  it("grants access via the folder picker", async () => {
    useMobileStore.setState({ grantState: "ungranted" });
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "Notesage", granted: true }));

    renderWithProviders(<Onboarding />);
    // The button is named for what the user does — pick a folder. The
    // permission story is told by the cards above it, not the control.
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));

    await waitFor(() => expect(useMobileStore.getState().grantState).toBe("granted"));
    expect(calledCommands()).toContain("ios_pick_library_folder");
  });

  it("reports a dismissed picker instead of silently doing nothing", async () => {
    // Regression lock. A cancelled pick used to resolve with granted:false and
    // fall through an `if` with no else — so it looked exactly like a dead
    // button. That ambiguity cost real debugging time when the bridge was
    // genuinely broken: there was no way to tell the two apart.
    useMobileStore.setState({ grantState: "ungranted" });
    setMockInvokeHandler("ios_pick_library_folder", () => ({ displayName: "", granted: false }));

    renderWithProviders(<Onboarding />);
    fireEvent.click(screen.getByRole("button", { name: "Select your Notesage folder" }));

    await waitFor(() => expect(calledCommands()).toContain("ios_pick_library_folder"));
    // Still ungranted, and the user was told why rather than left guessing.
    expect(useMobileStore.getState().grantState).toBe("ungranted");
    // The Toaster portal isn't mounted in this harness, so assert the call.
    const { toast } = await import("sonner");
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringMatching(/No folder selected/i),
      ),
    );
  });
});

describe("HTML reports", () => {
  const openHtml = async (fileName = "report.html") => {
    setMockInvokeHandler("ios_list_directory", () => [
      { name: fileName, path: fileName, is_directory: false, hidden: false },
    ]);
    setMockInvokeHandler(
      "ios_read_file",
      () => "<html><body><h1>Q3</h1><script>renderCharts()</script></body></html>",
    );
    renderWithProviders(<Shell />);
    fireEvent.click(await screen.findByText(fileName));
    return await screen.findByTitle(fileName);
  };

  it("renders an exported report instead of showing its markup as text", async () => {
    // The gap this closes: iOS Files shows a .html report as source with
    // scripts disabled, so a report with inline charts is unreadable on phone.
    const frame = await openHtml();
    expect(frame.tagName).toBe("IFRAME");
    expect(screen.queryByText(/<script>/)).toBeNull();
  });

  it("lets the report's own scripts run", async () => {
    const frame = await openHtml();
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
  });

  it("keeps the report on an opaque origin so it cannot reach the app", async () => {
    // `allow-scripts` WITHOUT `allow-same-origin` is the whole security
    // posture here: the report executes, but has no access to this app's DOM,
    // storage, or the Tauri IPC bridge. Granting same-origin alongside
    // allow-scripts would let a document remove its own sandbox entirely.
    const frame = await openHtml();
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("loads from a blob URL, not srcdoc, so the report's own styles survive", async () => {
    // A srcdoc document inherits the host CSP, and Tauri's nonce injection
    // neutralises 'unsafe-inline' — the report would render unstyled with its
    // scripts refused. A blob document is its own CSP context in WebKit.
    const frame = await openHtml();
    expect(frame.getAttribute("srcdoc")).toBeNull();
    expect(frame.getAttribute("src") ?? "").toMatch(/^blob:/);
  });

  it("treats .htm the same as .html", async () => {
    const frame = await openHtml("legacy.htm");
    expect(frame.tagName).toBe("IFRAME");
  });
});
