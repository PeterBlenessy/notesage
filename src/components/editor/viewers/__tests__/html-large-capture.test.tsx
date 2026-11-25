// @vitest-environment jsdom
/**
 * Opening a saved web page — a self-contained `.html` whose images are
 * inlined as base64 — in the HTML viewer.
 *
 * What is pinned here is COST, in units that do not depend on the machine:
 * how many characters DOMPurify is handed, how many times the whole document
 * is parsed or written through `innerHTML`, and that reopening a document or
 * stepping past one does no sanitising at all. Security equivalence of the
 * pipeline itself is in `src/lib/__tests__/html-viewer-sanitise.test.ts`.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

import "@/test/tauri-mock";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, fireEvent, screen, act } from "@testing-library/react";
import DOMPurify from "dompurify";
import { HtmlViewer } from "../HtmlViewer";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { useSettingsStore } from "@/stores/settings-store";
import { htmlSanitiseCache, HTML_DEFER_MIN_CHARS } from "@/lib/html-viewer-sanitise";
import { buildCapture, legacySanitisedBody } from "@/lib/__tests__/html-legacy-sanitise-reference";

vi.mock("../CodeEditor", () => ({
  CodeEditor: ({ content }: { content: string }) => (
    <div data-testid="code-editor">{content.length}</div>
  ),
}));

/** Anything at least this long counts as "the whole document". */
const FULL_DOCUMENT_CHARS = 1_000_000;
const CAPTURE_CHARS = 3_000_000;

const A = buildCapture(CAPTURE_CHARS, 6, "alpha");
const B = buildCapture(CAPTURE_CHARS, 5, "bravo");

/** A fresh string object with the same characters, as a re-read file would be. */
function reread(text: string): string {
  return (" " + text).slice(1);
}

interface Costs {
  sanitize: ReturnType<typeof vi.spyOn>;
  /** Lengths of every string given to `DOMParser.parseFromString`. */
  parsed: number[];
  /** Lengths of every string assigned to an element's `innerHTML`. */
  written: number[];
}

let costs: Costs;
let restoreInnerHtml: () => void;

beforeEach(() => {
  htmlSanitiseCache.clear();
  useSettingsStore.setState({
    htmlViewerAllowScripts: false,
    htmlViewerBlockExternalResources: false,
  });
  setMockInvokeHandler("repair_html_doctype", () => null);
  setMockInvokeHandler("html_preview_register", () => undefined);
  setMockInvokeHandler("html_preview_unregister", () => undefined);

  const parsed: number[] = [];
  const written: number[] = [];
  const realParse = DOMParser.prototype.parseFromString;
  vi.spyOn(DOMParser.prototype, "parseFromString").mockImplementation(function (
    this: DOMParser,
    text: string,
    type: DOMParserSupportedType,
  ) {
    parsed.push(text.length);
    return realParse.call(this, text, type);
  });
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML")!;
  Object.defineProperty(Element.prototype, "innerHTML", {
    ...descriptor,
    set(this: Element, value: string) {
      written.push(String(value).length);
      descriptor.set!.call(this, value);
    },
  });
  restoreInnerHtml = () => Object.defineProperty(Element.prototype, "innerHTML", descriptor);
  costs = { sanitize: vi.spyOn(DOMPurify, "sanitize"), parsed, written };
});

afterEach(() => {
  restoreInnerHtml();
  vi.restoreAllMocks();
});

function viewer(content: string, filePath: string, extra: Partial<React.ComponentProps<typeof HtmlViewer>> = {}) {
  return (
    <HtmlViewer
      content={content}
      fileName={filePath.slice(filePath.lastIndexOf("/") + 1)}
      filePath={filePath}
      tabId={filePath}
      isDirty={false}
      updateTabContent={vi.fn()}
      saveFileWithContent={vi.fn()}
      {...extra}
    />
  );
}

function surface(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>('[aria-label^="Rendered HTML"]')!;
}

function full(lengths: number[]): number {
  return lengths.filter((n) => n >= FULL_DOCUMENT_CHARS).length;
}

describe("HtmlViewer — opening a large capture", () => {
  it("paints the viewer's chrome before the document is sanitised", async () => {
    expect(A.html.length).toBeGreaterThan(HTML_DEFER_MIN_CHARS);
    const { container } = render(viewer(A.html, "/inbox/alpha.html"));

    // First render: toolbar and an empty, busy surface. No sanitising yet.
    expect(screen.getByLabelText("Find")).toBeTruthy();
    expect(surface(container).getAttribute("aria-busy")).toBe("true");
    expect(surface(container).childNodes.length).toBe(0);
    expect(costs.sanitize).not.toHaveBeenCalled();
    expect(costs.parsed.length).toBe(0);

    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(6));
    expect(surface(container).hasAttribute("aria-busy")).toBe(false);
  });

  it("hands DOMPurify a small string and touches the whole document once", async () => {
    const { container } = render(viewer(A.html, "/inbox/alpha.html"));
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(6));

    // One sanitise call, on a string that is a few percent of the file.
    expect(costs.sanitize).toHaveBeenCalledTimes(1);
    expect((costs.sanitize.mock.calls[0][0] as string).length).toBeLessThan(40_000);

    // The file itself is parsed exactly once; it used to be parsed three
    // times (DOMParser, DOMPurify's own DOMParser, then innerHTML) and
    // serialised twice in between.
    expect(full(costs.parsed)).toBe(1);
    expect(full(costs.written)).toBe(0);
    expect(Math.max(...costs.written)).toBeLessThan(40_000);
  });

  it("renders what the old pipeline rendered, with every image restored exactly", async () => {
    const { container } = render(viewer(A.html, "/inbox/alpha.html"));
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(6));

    const imgs = Array.from(container.querySelectorAll("img"));
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual(A.images);
    // Decoded off the main thread; never lazy (see mountPreparedHtml).
    for (const img of imgs) {
      expect(img.getAttribute("decoding")).toBe("async");
      expect(img.hasAttribute("loading")).toBe(false);
    }

    const reference = document.createElement("div");
    reference.innerHTML = legacySanitisedBody(A.html, false);
    const rendered = surface(container).cloneNode(true) as HTMLElement;
    for (const img of Array.from(rendered.querySelectorAll("img"))) img.removeAttribute("decoding");
    expect(rendered.innerHTML).toBe(reference.innerHTML);
  });

  it("reopening a document does no sanitising and no parse of the file", async () => {
    const first = render(viewer(A.html, "/inbox/alpha.html"));
    await waitFor(() => expect(first.container.querySelectorAll("img").length).toBe(6));
    first.unmount();

    costs.sanitize.mockClear();
    costs.parsed.length = 0;
    costs.written.length = 0;

    // The file is read again, so it is a different string with equal text.
    const again = render(viewer(reread(A.html), "/inbox/alpha.html"));

    // Ready in the first commit — no wait.
    const imgs = Array.from(again.container.querySelectorAll("img"));
    expect(imgs.map((img) => img.getAttribute("src"))).toEqual(A.images);
    expect(costs.sanitize).not.toHaveBeenCalled();
    expect(full(costs.parsed)).toBe(0);
    expect(full(costs.written)).toBe(0);
  });

  it("stepping back and forth between two captures sanitises each once", async () => {
    const view = render(viewer(A.html, "/inbox/alpha.html"));
    await waitFor(() => expect(view.container.textContent).toContain("alpha headline"));
    view.rerender(viewer(B.html, "/inbox/bravo.html"));
    await waitFor(() => expect(view.container.textContent).toContain("bravo headline"));
    expect(view.container.textContent).not.toContain("alpha headline");
    expect(costs.sanitize).toHaveBeenCalledTimes(2);

    view.rerender(viewer(reread(A.html), "/inbox/alpha.html"));
    expect(view.container.textContent).toContain("alpha headline");
    expect(view.container.textContent).not.toContain("bravo headline");
    view.rerender(viewer(reread(B.html), "/inbox/bravo.html"));
    expect(view.container.textContent).toContain("bravo headline");
    expect(Array.from(view.container.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(B.images);

    expect(costs.sanitize).toHaveBeenCalledTimes(2);
  });

  it("a changed file is sanitised again, never answered from the cache", async () => {
    const view = render(viewer(A.html, "/inbox/alpha.html"));
    await waitFor(() => expect(view.container.textContent).toContain("alpha headline"));

    // Same path, same length, one word different.
    const edited = A.html.replace("alpha headline", "ALPHA headline");
    expect(edited.length).toBe(A.html.length);
    view.rerender(viewer(edited, "/inbox/alpha.html"));

    expect(view.container.textContent).not.toContain("alpha headline");
    await waitFor(() => expect(view.container.textContent).toContain("ALPHA headline"));
    expect(costs.sanitize).toHaveBeenCalledTimes(2);
  });

  it("a document stepped past before its work started is never sanitised, and never shown", async () => {
    const view = render(viewer(A.html, "/inbox/alpha.html"));
    // ⌘↓ before the first paint: A's work is still only scheduled.
    view.rerender(viewer(B.html, "/inbox/bravo.html"));

    await waitFor(() => expect(view.container.textContent).toContain("bravo headline"));
    // Let anything that could still be pending run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(costs.sanitize).toHaveBeenCalledTimes(1);
    expect(costs.sanitize.mock.calls[0][0] as string).toContain("bravo headline");
    expect(view.container.textContent).not.toContain("alpha headline");
    expect(Array.from(view.container.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(B.images);
    expect(htmlSanitiseCache.size).toBe(1);
  });

  it("unmounting before the work started leaves nothing running", async () => {
    const view = render(viewer(A.html, "/inbox/alpha.html"));
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(costs.sanitize).not.toHaveBeenCalled();
    expect(htmlSanitiseCache.size).toBe(0);
  });

  it("applies a find query typed before the document arrived", async () => {
    const { container } = render(viewer(A.html, "/inbox/alpha.html"));
    fireEvent.click(screen.getByLabelText("Find"));
    fireEvent.change(screen.getByLabelText("Find in document"), { target: { value: "headline" } });
    expect(container.querySelectorAll("mark").length).toBe(0);

    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(6));
    await waitFor(() => expect(container.querySelectorAll("mark").length).toBe(1));
  });

  it("strips external resources from a large capture when the setting is on", async () => {
    useSettingsStore.setState({ htmlViewerBlockExternalResources: true });
    const { container } = render(viewer(A.html, "/inbox/alpha.html"));
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(6));

    expect(Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"))).toEqual(A.images);
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.hasAttribute("href")).toBe(false);
    }
    expect((costs.sanitize.mock.calls[0][0] as string).length).toBeLessThan(40_000);
    expect(full(costs.parsed)).toBe(1);
  });

  it("removes scripts and handlers from a large capture", async () => {
    const hostile = A.html.replace(
      "<article>",
      `<article><script>window.__pwned = 1</script><img src="${A.images[0]}" onerror="window.__pwned = 2"><a href="javascript:window.__pwned = 3">x</a>`,
    );
    const { container } = render(viewer(hostile, "/inbox/hostile.html"));
    await waitFor(() => expect(container.querySelectorAll("img").length).toBe(7));

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("[onerror]")).toBeNull();
    for (const a of Array.from(container.querySelectorAll("a"))) {
      expect(a.getAttribute("href") ?? "").not.toMatch(/^\s*javascript:/i);
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("HtmlViewer — small documents and other modes", () => {
  it("a small document is still rendered in the first commit and is not cached", () => {
    const { container } = render(viewer("<html><body><h1>Small</h1></body></html>", "/notes/small.html"));
    expect(container.querySelector("h1")?.textContent).toBe("Small");
    expect(surface(container).hasAttribute("aria-busy")).toBe(false);
    expect(costs.sanitize).toHaveBeenCalledTimes(1);
    expect(htmlSanitiseCache.size).toBe(0);
  });

  it("source mode does not sanitise at all, however often the text changes", async () => {
    const view = render(viewer(A.html, "/inbox/alpha.html", { sourceMode: true }));
    view.rerender(viewer(A.html + " ", "/inbox/alpha.html", { sourceMode: true, isDirty: true }));
    view.rerender(viewer("<p>typing</p>", "/inbox/alpha.html", { sourceMode: true, isDirty: true }));
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(screen.getByTestId("code-editor")).toBeTruthy();
    expect(costs.sanitize).not.toHaveBeenCalled();
    expect(costs.parsed.length).toBe(0);
  });
});
