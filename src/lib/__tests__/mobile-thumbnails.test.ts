// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileEntry } from "@/lib/tauri";

const iosReadFileMock = vi.fn<(relPath: string) => Promise<string>>();
const iosReadBinaryMock = vi.fn<(relPath: string) => Promise<Uint8Array>>();
const iosThumbnailMock = vi.fn<(relPath: string, maxPixel: number) => Promise<Uint8Array>>();
vi.mock("@/lib/ios-api", () => ({
  iosReadFile: (relPath: string) => iosReadFileMock(relPath),
  iosReadBinary: (relPath: string) => iosReadBinaryMock(relPath),
  iosThumbnail: (relPath: string, maxPixel: number) => iosThumbnailMock(relPath, maxPixel),
}));

const renderMarkdownFragmentMock = vi.fn<(markdown: string, theme: "light" | "dark") => Promise<string>>();
vi.mock("@/lib/markdown-render", () => ({
  renderMarkdownFragment: (markdown: string, theme: "light" | "dark") =>
    renderMarkdownFragmentMock(markdown, theme),
}));

const renderPdfThumbnailDataUrlMock = vi.fn<(bytes: Uint8Array) => Promise<string>>();
vi.mock("@/lib/mobile-pdf-thumbnail", () => ({
  renderPdfThumbnailDataUrl: (bytes: Uint8Array) => renderPdfThumbnailDataUrlMock(bytes),
}));

import {
  extractPreviewSource,
  createLimiter,
  getThumbnail,
  resetThumbnailCache,
  evictThumbnail,
  cancelPendingThumbnails,
} from "@/lib/mobile-thumbnails";

function entry(overrides: Partial<FileEntry> & { name: string }): FileEntry {
  return {
    path: overrides.name,
    is_directory: false,
    hidden: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetThumbnailCache();
  iosReadFileMock.mockReset();
  iosReadBinaryMock.mockReset();
  iosThumbnailMock.mockReset();
  // Default: native layer absent (web-pipeline fallback), like desktop/tests.
  iosThumbnailMock.mockRejectedValue(new Error("only available on iOS"));
  renderMarkdownFragmentMock.mockReset();
  renderPdfThumbnailDataUrlMock.mockReset();
  // jsdom has no createObjectURL — stub it the same way image-compress.test.ts does.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:mock-thumbnail-url"),
    revokeObjectURL: vi.fn(),
  });
});

describe("extractPreviewSource (#633)", () => {
  it("strips a leading YAML frontmatter block before truncating", () => {
    const raw = "---\ntitle: T\ntags: [a]\n---\n# Hello\n\nBody.";
    expect(extractPreviewSource(raw)).toBe("# Hello\n\nBody.");
  });

  it("keeps only the first N lines (default 10)", () => {
    const lines = Array.from({ length: 25 }, (_, i) => `line ${i}`);
    const preview = extractPreviewSource(lines.join("\n"));
    expect(preview.split("\n")).toHaveLength(10);
    expect(preview.split("\n")[9]).toBe("line 9");
  });

  it("respects a custom maxLines", () => {
    const lines = Array.from({ length: 5 }, (_, i) => `line ${i}`);
    expect(extractPreviewSource(lines.join("\n"), 3).split("\n")).toHaveLength(3);
  });
});

describe("getThumbnail dispatch (#633)", () => {
  it("resolves directories to a generic icon without reading anything", async () => {
    const result = await getThumbnail(
      entry({ name: "Sub", path: "Sub", is_directory: true }),
      { theme: "light" },
    );
    expect(result).toEqual({ kind: "icon" });
    expect(iosReadFileMock).not.toHaveBeenCalled();
    expect(iosReadBinaryMock).not.toHaveBeenCalled();
  });

  it("resolves unsupported file types to a generic icon without reading anything", async () => {
    const result = await getThumbnail(entry({ name: "archive.zip" }), { theme: "light" });
    expect(result).toEqual({ kind: "icon" });
    expect(iosReadFileMock).not.toHaveBeenCalled();
    expect(iosReadBinaryMock).not.toHaveBeenCalled();
  });

  it("markdown notes: reads the file, truncates to the preview source, and renders via the trusted comrak pipeline", async () => {
    const raw = "---\ntitle: T\n---\n" + Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    iosReadFileMock.mockResolvedValue(raw);
    renderMarkdownFragmentMock.mockResolvedValue("<p>preview</p>");

    const result = await getThumbnail(entry({ name: "note.md" }), { theme: "dark" });

    expect(iosReadFileMock).toHaveBeenCalledWith("note.md");
    const [renderedSource, theme] = renderMarkdownFragmentMock.mock.calls[0];
    expect(renderedSource.split("\n")).toHaveLength(10);
    expect(renderedSource).not.toMatch(/title: T/);
    expect(theme).toBe("dark");
    expect(result).toEqual({ kind: "markdown", html: "<p>preview</p>" });
  });

  it("text notes: also render through the trusted comrak pipeline", async () => {
    iosReadFileMock.mockResolvedValue("plain text content");
    renderMarkdownFragmentMock.mockResolvedValue("<p>plain text content</p>");

    const result = await getThumbnail(entry({ name: "todo.txt" }), { theme: "light" });

    expect(iosReadFileMock).toHaveBeenCalledWith("todo.txt");
    expect(result).toEqual({ kind: "markdown", html: "<p>plain text content</p>" });
  });

  it("images: reads binary bytes and resolves to a blob URL", async () => {
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const result = await getThumbnail(entry({ name: "photo.png" }), { theme: "light" });

    expect(iosReadBinaryMock).toHaveBeenCalledWith("photo.png");
    expect(result).toEqual({ kind: "image", url: "blob:mock-thumbnail-url" });
  });

  it("PDFs: reads binary bytes and delegates to the pdf thumbnail renderer", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    iosReadBinaryMock.mockResolvedValue(bytes);
    renderPdfThumbnailDataUrlMock.mockResolvedValue("data:image/png;base64,xyz");

    const result = await getThumbnail(entry({ name: "report.pdf" }), { theme: "light" });

    expect(iosReadBinaryMock).toHaveBeenCalledWith("report.pdf");
    expect(renderPdfThumbnailDataUrlMock).toHaveBeenCalledWith(bytes);
    expect(result).toEqual({ kind: "pdf", url: "data:image/png;base64,xyz" });
  });

  it("falls back to a generic icon (not a throw) when the read fails", async () => {
    iosReadFileMock.mockRejectedValue(new Error("not downloaded yet"));

    const result = await getThumbnail(entry({ name: "note.md" }), { theme: "light" });

    expect(result).toEqual({ kind: "icon" });
  });

  it("caches by path — a second request for the same entry does not re-read", async () => {
    iosReadFileMock.mockResolvedValue("# Hi");
    renderMarkdownFragmentMock.mockResolvedValue("<h1>Hi</h1>");
    const e = entry({ name: "note.md" });

    await getThumbnail(e, { theme: "light" });
    await getThumbnail(e, { theme: "light" });

    expect(iosReadFileMock).toHaveBeenCalledTimes(1);
  });
});

describe("createLimiter (#633 — bounded concurrent reads)", () => {
  it("runs at most `max` functions concurrently, queuing the rest", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];

    const task = () =>
      limit(
        () =>
          new Promise<void>((resolve) => {
            active++;
            maxActive = Math.max(maxActive, active);
            resolvers.push(() => {
              active--;
              resolve();
            });
          }),
      );

    const results = [task(), task(), task(), task(), task()];
    // Let all five tasks attempt to start.
    await Promise.resolve();
    await Promise.resolve();
    expect(maxActive).toBe(2);
    expect(active).toBe(2);

    // Release them one at a time — active must never exceed 2 even as the
    // queue drains.
    while (resolvers.length > 0) {
      resolvers.shift()!();
      await Promise.resolve();
      await Promise.resolve();
      expect(active).toBeLessThanOrEqual(2);
    }

    await Promise.all(results);
    expect(maxActive).toBe(2);
  });

  it("propagates the wrapped function's resolved value and rejection", async () => {
    const limit = createLimiter(1);
    await expect(limit(() => Promise.resolve(42))).resolves.toBe(42);
    await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });
});

describe("cancelPendingThumbnails (#633 frozen back-out)", () => {
  it("queued-but-unstarted generations resolve to icons without reading, and are evicted for retry", async () => {
    const reads: string[] = [];
    iosReadFileMock.mockImplementation((relPath) => {
      reads.push(relPath);
      // Slow read keeps the limiter's slots occupied so later jobs queue.
      return new Promise((resolve) => setTimeout(() => resolve("# hi"), 30));
    });
    renderMarkdownFragmentMock.mockResolvedValue("<h1>hi</h1>");

    // Fill both limiter slots, then queue two more.
    const inflight = [
      getThumbnail(entry({ name: "a.md" }), { theme: "light" }),
      getThumbnail(entry({ name: "b.md" }), { theme: "light" }),
    ];
    const queued = [
      getThumbnail(entry({ name: "c.md" }), { theme: "light" }),
      getThumbnail(entry({ name: "d.md" }), { theme: "light" }),
    ];
    cancelPendingThumbnails();

    const queuedResults = await Promise.all(queued);
    expect(queuedResults.map((r) => r.kind)).toEqual(["icon", "icon"]);
    await Promise.all(inflight);
    // The cancelled paths never touched the filesystem…
    expect(reads).not.toContain("c.md");
    expect(reads).not.toContain("d.md");
    // …and are not cached, so a revisit regenerates them.
    const retry = await getThumbnail(entry({ name: "c.md" }), { theme: "light" });
    expect(retry.kind).toBe("markdown");
  });
});

  it("an IN-FLIGHT job aborts at its next stage checkpoint and is evicted for retry", async () => {
    let releaseRead: (raw: string) => void = () => {};
    iosReadFileMock.mockImplementation(
      () => new Promise((resolve) => { releaseRead = resolve; }),
    );
    renderMarkdownFragmentMock.mockResolvedValue("<h1>hi</h1>");

    const inflight = getThumbnail(entry({ name: "big.md" }), { theme: "light" });
    // Let the job pass its pre-read checkpoints and start the read.
    await new Promise((r) => setTimeout(r, 5));
    cancelPendingThumbnails();
    releaseRead("# hi");

    // The post-read checkpoint fires: no render happens, the result is a
    // plain icon, and the render pipeline was never reached.
    const result = await inflight;
    expect(result.kind).toBe("icon");
    expect(renderMarkdownFragmentMock).not.toHaveBeenCalled();

    // Evicted — a revisit regenerates for real.
    iosReadFileMock.mockResolvedValue("# hi");
    const retry = await getThumbnail(entry({ name: "big.md" }), { theme: "light" });
    expect(retry.kind).toBe("markdown");
  });

describe("native-first thumbnails (QLThumbnailGenerator)", () => {
  it("uses the native generator for pdf/media and never touches the web pipeline", async () => {
    iosThumbnailMock.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const pdf = await getThumbnail(entry({ name: "doc.pdf" }), { theme: "light" });
    const mov = await getThumbnail(entry({ name: "clip.mov" }), { theme: "light" });
    expect(pdf.kind).toBe("image");
    expect(mov.kind).toBe("image");
    expect(iosReadBinaryMock).not.toHaveBeenCalled();
    expect(renderPdfThumbnailDataUrlMock).not.toHaveBeenCalled();
  });

  it("falls back to the web pipeline when the native layer is absent", async () => {
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([9, 9]));
    renderPdfThumbnailDataUrlMock.mockResolvedValue("data:image/png;base64,x");

    const pdf = await getThumbnail(entry({ name: "doc.pdf" }), { theme: "light" });
    expect(pdf.kind).toBe("pdf");
    expect(renderPdfThumbnailDataUrlMock).toHaveBeenCalled();
  });

  /**
   * HTML previews.
   *
   * `classifyFile` has returned "html" for a while, but `buildThumbnail`
   * matched no branch on it, so every web page fell through to the generic
   * icon. Invisible while HTML files were rare; a wall of identical icons once
   * article capture (#612) started producing folders of them.
   */
  it("renders an html file through the native generator", async () => {
    iosThumbnailMock.mockResolvedValue(new Uint8Array([1, 2, 3]));

    const page = await getThumbnail(entry({ name: "article.html" }), { theme: "light" });

    expect(page.kind).toBe("image");
    expect(iosThumbnailMock).toHaveBeenCalledWith("article.html", 480);
  });

  it("degrades an html file to an icon rather than an empty preview", async () => {
    // The native layer is absent here (the suite default). The wrong repair
    // would be routing html at the markdown pipeline: comrak runs without
    // `unsafe_` and strips raw HTML, so a page would render as a BLANK card —
    // worse than an icon, because it reads as a broken thumbnail rather than
    // an unpreviewable file.
    const page = await getThumbnail(entry({ name: "article.htm" }), { theme: "light" });

    expect(page.kind).toBe("icon");
    expect(renderMarkdownFragmentMock).not.toHaveBeenCalled();
    expect(iosReadFileMock).not.toHaveBeenCalled();
  });
});

/**
 * Theme correctness.
 *
 * Two failures with a path-only cache key, both reported as "thumbnails are
 * light in a dark app": React runs effects child-first, so a card's first
 * request can beat ThemeProvider's effect and cache a LIGHT thumbnail for the
 * session; and a theme flip left every generated thumbnail in the old theme.
 */
describe("thumbnails are cached per theme", () => {
  it("regenerates for the other theme rather than reusing", async () => {
    iosReadFileMock.mockResolvedValue("# hi");
    renderMarkdownFragmentMock.mockImplementation(async (_md, theme) => `<p>${theme}</p>`);

    const light = await getThumbnail(entry({ name: "a.md" }), { theme: "light" });
    const dark = await getThumbnail(entry({ name: "a.md" }), { theme: "dark" });

    expect(light).toEqual({ kind: "markdown", html: "<p>light</p>" });
    expect(dark).toEqual({ kind: "markdown", html: "<p>dark</p>" });
  });

  it("still caches within a theme", async () => {
    // The per-theme key must not cost the caching that keeps scrolling cheap.
    iosReadFileMock.mockResolvedValue("# hi");
    renderMarkdownFragmentMock.mockResolvedValue("<p>x</p>");

    await getThumbnail(entry({ name: "b.md" }), { theme: "dark" });
    await getThumbnail(entry({ name: "b.md" }), { theme: "dark" });

    expect(iosReadFileMock).toHaveBeenCalledTimes(1);
  });

  it("evicting a rewritten file drops BOTH themes", async () => {
    // Eviction follows a CONTENT change, which invalidates every rendering of
    // the file — not only the one currently on screen.
    iosReadFileMock.mockResolvedValue("# hi");
    renderMarkdownFragmentMock.mockResolvedValue("<p>x</p>");
    await getThumbnail(entry({ name: "c.md" }), { theme: "light" });
    await getThumbnail(entry({ name: "c.md" }), { theme: "dark" });
    expect(iosReadFileMock).toHaveBeenCalledTimes(2);

    evictThumbnail("c.md");

    await getThumbnail(entry({ name: "c.md" }), { theme: "light" });
    await getThumbnail(entry({ name: "c.md" }), { theme: "dark" });
    expect(iosReadFileMock).toHaveBeenCalledTimes(4);
  });
});
