// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { downscaleImage, getDesktopThumbnail, evictDesktopThumbnail, resetDesktopThumbnails } from "@/lib/desktop-thumbnails";

vi.mock("@/lib/mobile-pdf-thumbnail", () => ({
  renderPdfThumbnailDataUrl: vi.fn(async () => "data:image/png;base64,PDF"),
}));

function entry(name: string, modified = 1) {
  return { name, path: `/lib/Inbox/${name}`, is_directory: false, hidden: false, modified };
}

describe("desktop thumbnails", () => {
  beforeEach(() => {
    resetDesktopThumbnails();
    (globalThis as { URL: typeof URL }).URL.createObjectURL = vi.fn(() => "blob:lead");
    (globalThis as { URL: typeof URL }).URL.revokeObjectURL = vi.fn();
  });

  it("images go through the asset protocol — no read at all", async () => {
    const readBinary = vi.fn();
    setMockInvokeHandler("read_binary_file", readBinary);
    const thumb = await getDesktopThumbnail(entry("shot.png"));
    expect(thumb.kind).toBe("picture");
    expect(readBinary).not.toHaveBeenCalled();
  });

  it("captures use the article's lead image, read natively", async () => {
    setMockInvokeHandler("article_lead_image", () => new Uint8Array([1, 2, 3]).buffer);
    const thumb = await getDesktopThumbnail(entry("article.html"));
    expect(thumb).toEqual({ kind: "picture", url: "blob:lead" });
  });

  it("a capture without an inline image, and a document type, fall back to the icon", async () => {
    setMockInvokeHandler("article_lead_image", () => {
      throw new Error("no inline image in this article");
    });
    expect(await getDesktopThumbnail(entry("bare.html"))).toEqual({ kind: "icon" });
    expect(await getDesktopThumbnail(entry("deck.pptx"))).toEqual({ kind: "icon" });
    expect(await getDesktopThumbnail(entry("note.md"))).toEqual({ kind: "icon" });
  });

  it("PDFs render their first page through pdf.js", async () => {
    setMockInvokeHandler("read_binary_file", () => [37, 80, 68, 70]);
    expect(await getDesktopThumbnail(entry("report.pdf"))).toEqual({ kind: "picture", url: "data:image/png;base64,PDF" });
  });

  it("caches by path and mtime; eviction releases a blob URL", async () => {
    const lead = vi.fn(() => new Uint8Array([1]).buffer);
    setMockInvokeHandler("article_lead_image", lead);
    await getDesktopThumbnail(entry("a.html", 1));
    await getDesktopThumbnail(entry("a.html", 1));
    expect(lead).toHaveBeenCalledTimes(1);
    await getDesktopThumbnail(entry("a.html", 2)); // rewritten in place
    expect(lead).toHaveBeenCalledTimes(2);
    evictDesktopThumbnail("/lib/Inbox/a.html");
    await new Promise((r) => setTimeout(r, 0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:lead");
    await getDesktopThumbnail(entry("a.html", 2));
    expect(lead).toHaveBeenCalledTimes(3);
  });
});

// The lead image is the article's own picture at full size. It used to be
// kept whole as a Blob per row and decoded whole to paint a 56-point slot
// (perf review I-H2).
describe("desktop thumbnails — the lead image is kept small", () => {
  const original = {
    createImageBitmap: (globalThis as { createImageBitmap?: unknown }).createImageBitmap,
    getContext: HTMLCanvasElement.prototype.getContext,
    toBlob: HTMLCanvasElement.prototype.toBlob,
  };
  let drawn: Array<{ width: number; height: number }>;
  let closed: number;
  let kept: Blob[];

  function fakeWebview(bitmap: { width: number; height: number }) {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({
      ...bitmap,
      close: () => {
        closed += 1;
      },
    }));
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      const canvas = this;
      return {
        imageSmoothingQuality: "low",
        drawImage: () => drawn.push({ width: canvas.width, height: canvas.height }),
      };
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback, type?: string) {
      callback(new Blob([new Uint8Array(10)], { type }));
    };
  }

  beforeEach(() => {
    resetDesktopThumbnails();
    drawn = [];
    closed = 0;
    kept = [];
    (globalThis as { URL: typeof URL }).URL.createObjectURL = vi.fn((blob: Blob) => {
      kept.push(blob);
      return `blob:${kept.length}`;
    }) as unknown as typeof URL.createObjectURL;
    (globalThis as { URL: typeof URL }).URL.revokeObjectURL = vi.fn();
    // A 5,000-byte JPEG.
    setMockInvokeHandler("article_lead_image", () => {
      const bytes = new Uint8Array(5000);
      bytes.set([0xff, 0xd8, 0xff]);
      return bytes.buffer;
    });
  });

  afterEach(() => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = original.createImageBitmap;
    HTMLCanvasElement.prototype.getContext = original.getContext;
    HTMLCanvasElement.prototype.toBlob = original.toBlob;
  });

  it("redraws a large picture to cover the row's 112px slot and keeps only the small one", async () => {
    fakeWebview({ width: 2000, height: 1000 });
    const thumb = await getDesktopThumbnail(entry("article.html"));
    expect(thumb).toEqual({ kind: "picture", url: "blob:1" });
    // Covers 112×112 (object-cover), no larger: the short side is 112.
    expect(drawn).toEqual([{ width: 224, height: 112 }]);
    expect(kept).toHaveLength(1);
    expect(kept[0].size).toBe(10);
    expect(kept[0].type).toBe("image/jpeg");
    expect(closed).toBe(1);
  });

  it("the gallery asks for its own, larger, size — cached apart from the row's", async () => {
    fakeWebview({ width: 4000, height: 3000 });
    await getDesktopThumbnail(entry("article.html"), "row");
    await getDesktopThumbnail(entry("article.html"), "medium");
    await getDesktopThumbnail(entry("article.html"), "medium");
    expect(drawn).toEqual([
      { width: 149, height: 112 },
      { width: 640, height: 480 },
    ]);
  });

  it("never upscales: a picture already smaller than the slot is used as it is", async () => {
    fakeWebview({ width: 100, height: 80 });
    await getDesktopThumbnail(entry("article.html"));
    expect(drawn).toEqual([]);
    expect(kept[0].size).toBe(5000);
  });

  it("falls back to the full picture where the webview cannot redraw it", async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    expect(await downscaleImage(new Blob([new Uint8Array(4)]), { width: 112, height: 112 })).toBeNull();
    fakeWebview({ width: 2000, height: 1000 });
    HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    const thumb = await getDesktopThumbnail(entry("article.html"));
    expect(thumb.kind).toBe("picture");
    expect(kept[0].size).toBe(5000);
  });

  it("an image file and a PDF are one thumbnail whatever the slot", async () => {
    const readBinary = vi.fn(() => [37, 80, 68, 70]);
    setMockInvokeHandler("read_binary_file", readBinary);
    await getDesktopThumbnail(entry("report.pdf"), "row");
    await getDesktopThumbnail(entry("report.pdf"), "large");
    expect(readBinary).toHaveBeenCalledTimes(1);
  });
});
