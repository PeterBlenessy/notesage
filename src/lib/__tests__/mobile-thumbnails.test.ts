// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileEntry } from "@/lib/tauri";

const iosReadFileMock = vi.fn<(relPath: string) => Promise<string>>();
const iosReadBinaryMock = vi.fn<(relPath: string) => Promise<Uint8Array>>();
vi.mock("@/lib/ios-api", () => ({
  iosReadFile: (relPath: string) => iosReadFileMock(relPath),
  iosReadBinary: (relPath: string) => iosReadBinaryMock(relPath),
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
