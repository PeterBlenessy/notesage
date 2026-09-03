// @vitest-environment jsdom
import "@/test/tauri-mock";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setMockInvokeHandler } from "@/test/tauri-mock";
import { getDesktopThumbnail, evictDesktopThumbnail, resetDesktopThumbnails } from "@/lib/desktop-thumbnails";

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
