import { convertFileSrc } from "@tauri-apps/api/core";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { classifyFile } from "@/components/mobile/FileRow";
import { createLimiter } from "@/lib/mobile-thumbnails";
import { log } from "@/lib/logger";

/**
 * Thumbnails for the desktop Inbox — the phone's pipeline minus QuickLook,
 * which the desktop does not have.
 *
 *   image   → the file itself through the asset protocol (no read, no blob)
 *   pdf     → first page rendered by pdf.js, loaded only when a PDF appears
 *   html    → the capture's inlined lead image, read natively (`article_lead_image`),
 *             then downscaled ONCE to the slot it is shown in
 *   other   → no picture; the row shows the type icon
 *
 * Results are promises cached by path + mtime (+ slot, for a capture), so a re-render is
 * free and a rewritten file (the image sweep, an update from source)
 * regenerates. At most two generations run at once — the list mounts dozens
 * of rows in one frame and pdf.js on the main thread would otherwise stall
 * the scroll.
 *
 * The lead image is the article's own picture at full size — often a
 * megapixel photograph for a 56-point slot. Kept as it arrived, every row
 * held the whole file as a Blob and the webview decoded all of it to paint
 * a thumbnail. It is decoded once here (off the main thread, by
 * `createImageBitmap`), drawn at the size the slot needs, and only the small
 * result is kept. Where the webview cannot do that, the full image is used
 * as before.
 */
export type DesktopThumbnail = { kind: "picture"; url: string } | { kind: "icon" };

/** The lead image arrives as bare bytes (the crate drops the data-URI
 *  prefix); the type is in the first bytes anyway. */
export function sniffImageMime(b: Uint8Array): string {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return "application/octet-stream";
}

/** The box a thumbnail has to COVER, in device pixels (`object-cover`). */
export interface ThumbnailBox {
  width: number;
  height: number;
}

/** Where a thumbnail is shown: the list row, or a gallery card of a size. */
export type ThumbnailSlot = "row" | "small" | "medium" | "large";

/**
 * Each slot at 2x. The row's is 56 pt square (40 pt condensed). A card's is
 * 16:10, and a card grows until another column fits, so its box is about
 * the widest that size gets.
 */
const SLOT_BOX: Record<ThumbnailSlot, ThumbnailBox> = {
  row: { width: 112, height: 112 },
  small: { width: 448, height: 280 },
  medium: { width: 640, height: 400 },
  large: { width: 896, height: 560 },
};

const cache = new Map<string, Promise<DesktopThumbnail>>();
const limiter = createLimiter(2);

/** Only a capture's picture depends on the slot; the others are one per file. */
function cacheKey(entry: FileEntry, slot: ThumbnailSlot): string {
  const sized = classifyFile(entry.name) === "html" ? `#${slot}` : "";
  return `${entry.path}@${entry.modified ?? 0}${sized}`;
}

/**
 * `blob` redrawn just large enough to cover `box`, or `null` when there is
 * nothing to gain (already that small) or the webview cannot do it — the
 * caller then keeps the original. Never upscales.
 */
export async function downscaleImage(blob: Blob, box: ThumbnailBox): Promise<Blob | null> {
  if (typeof createImageBitmap !== "function") return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.max(box.width / bitmap.width, box.height / bitmap.height);
    if (!(scale < 1)) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // JPEG stays JPEG; anything that can carry transparency becomes PNG.
    const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

async function build(entry: FileEntry, slot: ThumbnailSlot): Promise<DesktopThumbnail> {
  const kind = classifyFile(entry.name);
  const box = SLOT_BOX[slot];
  try {
    if (kind === "image") {
      return { kind: "picture", url: convertFileSrc(entry.path) };
    }
    if (kind === "html") {
      const started = performance.now();
      const bytes = await tauriApi.articleLeadImage(entry.path);
      const full = new Blob([bytes.slice().buffer], { type: sniffImageMime(bytes) });
      const small = await downscaleImage(full, box);
      log.info("perf:inbox", "thumb", {
        bytes: full.size,
        kept: (small ?? full).size,
        box: `${box.width}x${box.height}`,
        ms: Math.round(performance.now() - started),
      });
      return { kind: "picture", url: URL.createObjectURL(small ?? full) };
    }
    if (kind === "pdf") {
      const bytes = new Uint8Array(await tauriApi.readBinaryFile(entry.path));
      const { renderPdfThumbnailDataUrl } = await import("./mobile-pdf-thumbnail");
      const url = await renderPdfThumbnailDataUrl(bytes, 320, () => false);
      return { kind: "picture", url };
    }
  } catch {
    // A capture with no inline image, an unreadable file, a PDF pdf.js
    // rejects: the icon is the honest fallback, never an error row.
  }
  return { kind: "icon" };
}

export function getDesktopThumbnail(entry: FileEntry, slot: ThumbnailSlot = "row"): Promise<DesktopThumbnail> {
  const key = cacheKey(entry, slot);
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = limiter(() => build(entry, slot));
  cache.set(key, promise);
  return promise;
}

/** Forget one path — after a rewrite in place, or a move out of the Inbox. */
export function evictDesktopThumbnail(path: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${path}@`)) {
      const pending = cache.get(key);
      cache.delete(key);
      void pending?.then((r) => {
        if (r.kind === "picture" && r.url.startsWith("blob:")) URL.revokeObjectURL(r.url);
      });
    }
  }
}

/** Test-only: the cache is module-level. */
export function resetDesktopThumbnails(): void {
  for (const key of [...cache.keys()]) evictDesktopThumbnail(key.slice(0, key.lastIndexOf("@")));
  cache.clear();
}
