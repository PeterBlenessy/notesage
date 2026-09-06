// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FileEntry } from "@/lib/tauri";

const iosReadFileMock = vi.fn<(relPath: string) => Promise<string>>();
const iosReadBinaryMock = vi.fn<(relPath: string) => Promise<Uint8Array>>();
const iosThumbnailMock = vi.fn<(relPath: string, maxPixel: number) => Promise<Uint8Array>>();
const iosArticleThumbnailMock = vi.fn<(relPath: string) => Promise<Uint8Array>>();
const iosThumbCacheGetMock = vi.fn<(key: string) => Promise<Uint8Array | null>>();
const iosThumbCachePutMock = vi.fn<(key: string, base64: string) => Promise<void>>();
vi.mock("@/lib/ios-api", () => ({
  iosReadFile: (relPath: string) => iosReadFileMock(relPath),
  iosReadBinary: (relPath: string) => iosReadBinaryMock(relPath),
  iosThumbnail: (relPath: string, maxPixel: number) => iosThumbnailMock(relPath, maxPixel),
  iosArticleThumbnail: (relPath: string) => iosArticleThumbnailMock(relPath),
  iosThumbCacheGet: (key: string) => iosThumbCacheGetMock(key),
  iosThumbCachePut: (key: string, base64: string) => iosThumbCachePutMock(key, base64),
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
    // A real listing carries one, and the disk cache refuses to key without
    // it — so the default has to have it or every test silently exercises the
    // no-cache path.
    modified: 1_700_000_000,
    ...overrides,
  };
}

beforeEach(() => {
  resetThumbnailCache();
  iosReadFileMock.mockReset();
  iosReadBinaryMock.mockReset();
  iosThumbnailMock.mockReset();
  iosArticleThumbnailMock.mockReset();
  // Default: no inline image, so tests opt IN to the lead-image path.
  iosArticleThumbnailMock.mockRejectedValue(new Error("no inline image in this article"));
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
    expect(result).toMatchObject({ kind: "image", url: "blob:mock-thumbnail-url" });
  });

  it("PDFs: reads binary bytes and delegates to the pdf thumbnail renderer", async () => {
    const bytes = new Uint8Array([9, 9, 9]);
    iosReadBinaryMock.mockResolvedValue(bytes);
    renderPdfThumbnailDataUrlMock.mockResolvedValue("data:image/png;base64,xyz");

    const result = await getThumbnail(entry({ name: "report.pdf" }), { theme: "light" });

    expect(iosReadBinaryMock).toHaveBeenCalledWith("report.pdf");
    expect(renderPdfThumbnailDataUrlMock).toHaveBeenCalledWith(bytes);
    expect(result).toMatchObject({ kind: "pdf", url: "data:image/png;base64,xyz" });
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

/**
 * Article thumbnails are the article's own photo.
 *
 * Peter, on build 6: "I am really not recognizing the docs in the inbox
 * compared to the share preview. That is what stuck in my mind and what I'm
 * looking for in the gallery, but see the small version of the full page."
 *
 * A page rendered into a square is accurate and useless — nobody remembers a
 * layout. The sweep already embedded the photo that does stick.
 */
describe("html thumbnails prefer the article's own lead image", () => {
  it("uses the embedded photo instead of a page render", async () => {
    iosArticleThumbnailMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    iosThumbnailMock.mockResolvedValue(new Uint8Array([9, 9, 9]));

    const out = await getThumbnail(entry({ name: "article.html" }), { theme: "dark" });

    expect(out.kind).toBe("image");
    expect(iosArticleThumbnailMock).toHaveBeenCalledWith("article.html");
    // The page render is never even attempted when a photo exists.
    expect(iosThumbnailMock).not.toHaveBeenCalled();
  });

  it("falls back to the system render when the article has no inline image", async () => {
    // An unswept capture, an image-less piece, or a plain HTML file the user
    // dropped in the library themselves.
    iosThumbnailMock.mockResolvedValue(new Uint8Array([9, 9, 9]));

    const out = await getThumbnail(entry({ name: "plain.html" }), { theme: "light" });

    expect(out.kind).toBe("image");
    expect(iosThumbnailMock).toHaveBeenCalled();
  });

  it("degrades to an icon when neither path yields anything", async () => {
    const out = await getThumbnail(entry({ name: "bare.html" }), { theme: "light" });
    expect(out.kind).toBe("icon");
  });

  it("does not touch the lead-image path for non-html files", async () => {
    iosReadFileMock.mockResolvedValue("# note");
    renderMarkdownFragmentMock.mockResolvedValue("<h1>note</h1>");

    await getThumbnail(entry({ name: "note.md" }), { theme: "light" });

    expect(iosArticleThumbnailMock).not.toHaveBeenCalled();
  });
});

describe("blob URLs are released", () => {
  it("revokes a thumbnail's URL when the file is evicted", async () => {
    // createObjectURL pins the blob until revoked. The sweep rewrites
    // documents and evicts their thumbnails, so without this the leak grows
    // with exactly the work the feature does most of.
    iosArticleThumbnailMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:thumb-1"),
      revokeObjectURL: revoke,
    });

    await getThumbnail(entry({ name: "a.html" }), { theme: "light" });
    evictThumbnail("a.html");
    await new Promise((r) => setTimeout(r, 0));

    expect(revoke).toHaveBeenCalledWith("blob:thumb-1");
  });

  it("does not try to revoke a data: URL", async () => {
    // The pdf.js fallback yields a data URI — a plain string with nothing to
    // free. Revoking it is harmless but signals a misunderstanding.
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([9, 9]));
    renderPdfThumbnailDataUrlMock.mockResolvedValue("data:image/png;base64,x");
    const revoke = vi.fn();
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:unused"),
      revokeObjectURL: revoke,
    });

    const out = await getThumbnail(entry({ name: "doc.pdf" }), { theme: "light" });
    expect(out.kind).toBe("pdf");
    evictThumbnail("doc.pdf");
    await new Promise((r) => setTimeout(r, 0));

    expect(revoke).not.toHaveBeenCalled();
  });
});

describe("OpenDocument thumbnails (share-to-Inbox coverage)", () => {
  /** A minimal but REAL .odt: a zip with the spec-mandated embedded preview. */
  async function odtBytes(withThumbnail: boolean): Promise<Uint8Array> {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    zip.file("mimetype", "application/vnd.oasis.opendocument.text");
    zip.file("content.xml", "<office:document-content/>");
    if (withThumbnail) {
      // Not a valid PNG, and deliberately so — the pipeline must not need to
      // decode it. `shrinkForCard` degrades to the original bytes when
      // createImageBitmap is unavailable, which is exactly the jsdom case.
      zip.file("Thumbnails/thumbnail.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    }
    return await zip.generateAsync({ type: "uint8array" });
  }

  it("falls back to the preview embedded in the package when QuickLook has none", async () => {
    // iOS ships no OpenDocument generator, so the native call failing here is
    // the expected production path for odt/odp, not an edge case.
    iosReadBinaryMock.mockResolvedValue(await odtBytes(true));
    const result = await getThumbnail(entry({ name: "report.odt" }), {
      theme: "light",
    });
    expect(result).toMatchObject({ kind: "image", url: "blob:mock-thumbnail-url" });
    expect(iosThumbnailMock).toHaveBeenCalled(); // native tried first
  });

  it("degrades to the generic icon when the package carries no preview", async () => {
    // The ODF spec allows omitting it. A produced-by-script document might.
    iosReadBinaryMock.mockResolvedValue(await odtBytes(false));
    const result = await getThumbnail(entry({ name: "bare.odp" }), {
      theme: "light",
    });
    expect(result).toEqual({ kind: "icon" });
  });

  it("does not read the file at all when QuickLook succeeds", async () => {
    // The fallback is strictly a fallback: on an OS that grows ODF support,
    // this must cost nothing — no multi-MB read, no zip parse.
    iosThumbnailMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const result = await getThumbnail(entry({ name: "report.odt" }), {
      theme: "light",
    });
    expect(result).toMatchObject({ kind: "image", url: "blob:mock-thumbnail-url" });
    expect(iosReadBinaryMock).not.toHaveBeenCalled();
  });
});

describe("imageMimeFor coverage of capture-pipeline image formats", () => {
  /**
   * The web fallback tags the blob with this MIME. Every image format
   * share-to-Inbox can save must map to a real one — `application/octet-stream`
   * renders nothing, and the failure is silent (an empty card, not an error).
   *
   * heic and tiff are the ones that were missing: heic since the fallback was
   * written, tiff the moment the classifier learned about it.
   */
  it.each([
    ["photo.png", "image/png"],
    ["photo.jpg", "image/jpeg"],
    ["photo.jpeg", "image/jpeg"],
    ["photo.gif", "image/gif"],
    ["photo.webp", "image/webp"],
    ["photo.svg", "image/svg+xml"],
    ["photo.heic", "image/heic"],
    ["scan.tiff", "image/tiff"],
    ["scan.tif", "image/tiff"],
  ])("maps %s to %s", async (name, expected) => {
    // Exercised through the public path: native fails, so the web fallback
    // runs and shrinkForCard receives the blob built from this MIME.
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const blobs: string[] = [];
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends RealBlob {
        constructor(parts: BlobPart[], opts?: BlobPropertyBag) {
          super(parts, opts);
          if (opts?.type) blobs.push(opts.type);
        }
      },
    );
    try {
      await getThumbnail(entry({ name }), { theme: "light" });
    } finally {
      vi.stubGlobal("Blob", RealBlob);
    }
    expect(blobs).toContain(expected);
  });
});

describe("the disk cache keeps a picture across launches", () => {
  // A miss by default, so every other test in this file behaves as before.
  beforeEach(() => {
    iosThumbCacheGetMock.mockReset().mockResolvedValue(null);
    iosThumbCachePutMock.mockReset().mockResolvedValue(undefined);
  });

  it("writes the picture it just built, from the bytes it already holds", async () => {
    // NOT by re-reading the object URL: the app's CSP has no `blob:` in
    // `connect-src`, so `fetch` on one is refused. That is how this cache
    // first shipped creating its directory and writing nothing into it.
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const result = await getThumbnail(entry({ name: "photo.png" }), { theme: "light" });
    expect(result.kind).toBe("image");
    await vi.waitFor(() => expect(iosThumbCachePutMock).toHaveBeenCalled());
    const [key, base64] = iosThumbCachePutMock.mock.calls[0];
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(base64.length).toBeGreaterThan(0);
  });

  it("refuses to cache a file with no modification time", async () => {
    // `LibraryAccess` reads mtime with a `try?`, so it is legitimately absent
    // for an iCloud placeholder. Keying on a `?? 0` fallback would make the
    // digest a CONSTANT for that path: edit the file and the stale picture
    // would be served for ever. No mtime, no cache.
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    // Let any earlier test's in-flight write land BEFORE clearing, so a
    // straggler on a shared mock is not blamed on this call.
    await new Promise((resolve) => setTimeout(resolve, 0));
    iosThumbCacheGetMock.mockClear();
    iosThumbCachePutMock.mockClear();
    const noMtime = { name: "ghost.png", path: "Inbox/ghost.png", is_directory: false, hidden: false };
    await getThumbnail(noMtime, { theme: "light" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(iosThumbCacheGetMock).not.toHaveBeenCalled();
    expect(iosThumbCachePutMock).not.toHaveBeenCalled();
  });

  it("does not keep the bytes alive once they are on disk", async () => {
    // Keeping them on the result would pin a second copy of every picture in
    // the session cache, beside the Blob the object URL already holds.
    iosReadBinaryMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const result = await getThumbnail(entry({ name: "photo.png" }), { theme: "light" });
    await vi.waitFor(() => expect(iosThumbCachePutMock).toHaveBeenCalled());
    if (result.kind === "image") expect(result.bytes).toBeUndefined();
  });

  it("serves a hit without reading the file at all", async () => {
    iosThumbCacheGetMock.mockResolvedValue(new Uint8Array([4, 5, 6]));
    const result = await getThumbnail(entry({ name: "cached.png" }), { theme: "light" });
    expect(result).toMatchObject({ kind: "image" });
    expect(iosReadBinaryMock).not.toHaveBeenCalled();
    expect(iosThumbnailMock).not.toHaveBeenCalled();
  });
});
