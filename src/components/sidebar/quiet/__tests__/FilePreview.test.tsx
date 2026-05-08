// @vitest-environment jsdom

/**
 * Unit tests for FilePreview — the 800ms hover popover that shows the first
 * ~10 lines of a file.
 *
 * Test strategy:
 *   - `vi.useFakeTimers()` controls the hover delay and close-grace timers.
 *   - The `read_file` Tauri command is mocked via the shared tauri-mock harness.
 *   - `prefers-reduced-motion` is controlled via a `matchMedia` stub so the
 *     animation-class assertion is deterministic.
 *   - Pure helpers (`isPreviewable`, `stripFrontmatter`, `extractPreviewLines`)
 *     are exercised directly without rendering.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import {
  renderWithProviders,
  screen,
  fireEvent,
  setMockInvokeHandler,
  clearMockInvokeHandlers,
} from "@/test/component-harness";
import {
  FilePreview,
  isPreviewable,
  stripFrontmatter,
  extractPreviewLines,
  extractFrontmatterTitle,
  extractPreviewParts,
  splitFrontmatter,
} from "../FilePreview";

// ---------------------------------------------------------------------------
// matchMedia stub — FilePreview reads `prefers-reduced-motion` via
// `useReducedMotion`; jsdom does not provide `matchMedia` by default.
// ---------------------------------------------------------------------------

let reducedMotion = false;

function installMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches:
        query === "(prefers-reduced-motion: reduce)" ? reducedMotion : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: () => false,
    }),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTrigger() {
  // FilePreview wraps children in a <div> trigger. The child row exposes the
  // text "Trigger" in these tests — grab its parent <div> which owns the
  // mouse-enter handler.
  return screen.getByText("Trigger").parentElement as HTMLElement;
}

/** Advance fake timers inside act() and flush pending microtasks. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  // Let any resolved promises (read_file) flush their .then handlers.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("FilePreview — pure helpers", () => {
  it("isPreviewable accepts known text extensions", () => {
    expect(isPreviewable("/a/b.md")).toBe(true);
    expect(isPreviewable("/a/b.markdown")).toBe(true);
    expect(isPreviewable("/a/b.txt")).toBe(true);
    expect(isPreviewable("/a/b.ts")).toBe(true);
    expect(isPreviewable("/a/b.JSON")).toBe(true); // case-insensitive
  });

  it("isPreviewable rejects binary / unsupported extensions", () => {
    expect(isPreviewable("/a/b.pdf")).toBe(false);
    expect(isPreviewable("/a/b.png")).toBe(false);
    expect(isPreviewable("/a/b.epub")).toBe(false);
    expect(isPreviewable("/a/Makefile")).toBe(false); // no extension
    expect(isPreviewable("/a/.env")).toBe(false); // hidden, no ext
  });

  it("stripFrontmatter removes a leading YAML block", () => {
    const input = "---\ntitle: Hello\ntags: []\n---\n# Body\nContent";
    expect(stripFrontmatter(input)).toBe("# Body\nContent");
  });

  it("stripFrontmatter leaves non-frontmatter content untouched", () => {
    const input = "# Heading\nbody";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("stripFrontmatter handles an unterminated block by returning original", () => {
    const input = "---\ntitle: no closing fence\nkeep going";
    expect(stripFrontmatter(input)).toBe(input);
  });

  it("extractPreviewLines strips frontmatter before counting", () => {
    const input =
      "---\ntitle: X\n---\nline1\nline2\nline3\nline4\nline5\nline6";
    expect(extractPreviewLines(input, 3)).toBe("line1\nline2\nline3");
  });

  it("extractPreviewLines caps at N lines of plain text", () => {
    const body = Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join("\n");
    const result = extractPreviewLines(body, 10);
    expect(result.split("\n")).toHaveLength(10);
    expect(result.split("\n")[0]).toBe("L1");
    expect(result.split("\n")[9]).toBe("L10");
  });

  // ----------------------------------------------------------------
  // Live-test 2026-04-25 — title extraction. The popover used to
  // render a leading `# Heading` (or whatever was in the frontmatter
  // `title:` field) as a big bold heading at the top of the body.
  // The new helpers lift that title out so the caller can render it
  // as a small grey subline next to the filename.
  // ----------------------------------------------------------------

  describe("splitFrontmatter", () => {
    it("returns the frontmatter block (without fences) and the body separately", () => {
      const input = "---\ntitle: Hello\ntag: x\n---\n# Body\nContent";
      const { frontmatter, body } = splitFrontmatter(input);
      expect(frontmatter).toBe("title: Hello\ntag: x");
      expect(body).toBe("# Body\nContent");
    });

    it("returns empty frontmatter when no fence is present", () => {
      const { frontmatter, body } = splitFrontmatter("# Just a heading\nBody");
      expect(frontmatter).toBe("");
      expect(body).toBe("# Just a heading\nBody");
    });

    it("returns empty frontmatter when the block is unterminated", () => {
      const input = "---\ntitle: Hello\nNo closing fence";
      const { frontmatter, body } = splitFrontmatter(input);
      expect(frontmatter).toBe("");
      expect(body).toBe(input);
    });
  });

  describe("extractFrontmatterTitle", () => {
    it("returns the bare title value", () => {
      expect(extractFrontmatterTitle("title: Hello")).toBe("Hello");
    });

    it("strips a single layer of double quotes", () => {
      expect(extractFrontmatterTitle('title: "Hello, World"')).toBe("Hello, World");
    });

    it("strips a single layer of single quotes", () => {
      expect(extractFrontmatterTitle("title: 'Hello'")).toBe("Hello");
    });

    it("returns null when no title field is present", () => {
      expect(extractFrontmatterTitle("foo: bar\ntag: x")).toBeNull();
    });

    it("returns null for an empty frontmatter", () => {
      expect(extractFrontmatterTitle("")).toBeNull();
    });

    it("matches title case-insensitively", () => {
      expect(extractFrontmatterTitle("Title: Hello")).toBe("Hello");
      expect(extractFrontmatterTitle("TITLE: Hello")).toBe("Hello");
    });
  });

  describe("extractPreviewParts", () => {
    it("extracts the frontmatter title and strips it from the body", () => {
      const input = "---\ntitle: Document Title\n---\n\nFirst paragraph.\nSecond paragraph.";
      const { title, body } = extractPreviewParts(input, 10);
      expect(title).toBe("Document Title");
      expect(body).toContain("First paragraph.");
      expect(body).not.toContain("title:");
    });

    it("falls back to a leading H1 when frontmatter has no title", () => {
      const input = "# Document Title\n\nFirst paragraph.\nSecond paragraph.";
      const { title, body } = extractPreviewParts(input, 10);
      expect(title).toBe("Document Title");
      // Body should NOT contain the H1 line; it should start at the first
      // paragraph.
      expect(body.startsWith("First paragraph.")).toBe(true);
      expect(body).not.toContain("# Document Title");
    });

    it("preserves H1 elsewhere in the body", () => {
      const input = "Intro paragraph.\n\n# Section heading\n\nMore text.";
      const { title, body } = extractPreviewParts(input, 10);
      expect(title).toBeNull();
      expect(body).toContain("# Section heading");
    });

    it("returns null title when neither frontmatter nor leading H1 present", () => {
      const input = "Just body text\nMore body text";
      const { title, body } = extractPreviewParts(input, 10);
      expect(title).toBeNull();
      expect(body).toBe(input);
    });

    it("caps the body at lineCount lines", () => {
      const lines = Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join("\n");
      const input = `# Title\n\n${lines}`;
      const { title, body } = extractPreviewParts(input, 5);
      expect(title).toBe("Title");
      expect(body.split("\n")).toHaveLength(5);
      expect(body.split("\n")[0]).toBe("L1");
    });

    it("frontmatter title takes precedence over a body H1", () => {
      const input = "---\ntitle: From frontmatter\n---\n\n# Different heading in body\n\nMore.";
      const { title, body } = extractPreviewParts(input, 10);
      expect(title).toBe("From frontmatter");
      // The body H1 stays — it isn't the title we lifted.
      expect(body).toContain("# Different heading in body");
    });
  });
});

// ---------------------------------------------------------------------------
// Component behavior
// ---------------------------------------------------------------------------

describe("FilePreview — hover behavior", () => {
  let readFileSpy: ReturnType<typeof vi.fn<(path: string) => Promise<string>>>;

  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = false;
    installMatchMedia();
    clearMockInvokeHandlers();
    readFileSpy = vi.fn<(path: string) => Promise<string>>(
      async () => "line1\nline2\nline3",
    );
    setMockInvokeHandler("read_file", (args) =>
      readFileSpy((args as { path: string }).path),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMockInvokeHandlers();
  });

  it("renders the trigger without opening the popover", () => {
    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    expect(screen.getByText("Trigger")).toBeTruthy();
    // Popover content is not in the DOM yet.
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("opens the popover and fetches the file after a 800ms hover", async () => {
    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    // Not yet open.
    expect(screen.queryByRole("tooltip")).toBeNull();

    await advance(800);

    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(readFileSpy).toHaveBeenCalledWith("/docs/notes.md");
  });

  it("renders the first N lines of content and drops the trailing tail", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `L${i + 1}`).join("\n");
    readFileSpy.mockImplementation(async () => body);

    renderWithProviders(
      <FilePreview filePath="/docs/long.md" lineCount={10}>
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(800);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("L1");
    expect(tooltip.textContent).toContain("L10");
    expect(tooltip.textContent).not.toContain("L11");
  });

  it("strips YAML frontmatter before line-counting", async () => {
    const body = "---\ntitle: T\ntags: [a]\n---\nfirst\nsecond\nthird";
    readFileSpy.mockImplementation(async () => body);

    renderWithProviders(
      <FilePreview filePath="/docs/fm.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(800);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.textContent).toContain("first");
    expect(tooltip.textContent).not.toContain("title: T");
  });

  it('shows "No preview available" for unsupported extensions without calling read_file', async () => {
    renderWithProviders(
      <FilePreview filePath="/docs/book.pdf">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(800);

    expect(screen.getByRole("tooltip").textContent).toContain(
      "No preview available",
    );
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('shows "Preview unavailable" when read_file rejects', async () => {
    readFileSpy.mockImplementation(async () => {
      throw new Error("boom");
    });

    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(800);

    expect(screen.getByRole("tooltip").textContent).toContain(
      "Preview unavailable",
    );
  });

  it("caches the preview body across hovers (read_file called once)", async () => {
    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    // First hover → fetch.
    fireEvent.mouseEnter(getTrigger());
    await advance(800);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(readFileSpy).toHaveBeenCalledTimes(1);

    // Leave → close.
    fireEvent.mouseLeave(getTrigger());
    await advance(200);

    // Second hover → cache hit, no new fetch.
    fireEvent.mouseEnter(getTrigger());
    await advance(800);
    expect(screen.getByRole("tooltip")).toBeTruthy();
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it("does not open the popover when the mouse leaves before the delay elapses", async () => {
    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(300);
    fireEvent.mouseLeave(getTrigger());
    await advance(1000);

    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("marks the popover with data-reduced-motion when the user opts in", async () => {
    reducedMotion = true;

    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(800);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.getAttribute("data-reduced-motion")).toBe("true");
    // Animation suppression relies on the `motion-reduce:` tailwind variant,
    // which maps to `@media (prefers-reduced-motion: reduce)` and so is
    // applied by the browser (not easily testable in jsdom). The
    // `data-reduced-motion` attribute is the render-time signal that the
    // hook fired.
    expect(tooltip.className).toMatch(/motion-reduce:/);
  });

  it("leaves animations enabled when reduced-motion is not set", async () => {
    reducedMotion = false;

    renderWithProviders(
      <FilePreview filePath="/docs/notes.md">
        <button>Trigger</button>
      </FilePreview>,
    );

    fireEvent.mouseEnter(getTrigger());
    await advance(800);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.getAttribute("data-reduced-motion")).toBeNull();
  });
});
