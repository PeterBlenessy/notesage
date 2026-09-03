import { convertFileSrc } from "@tauri-apps/api/core";
import { tauriApi, type FileEntry } from "@/lib/tauri";
import { classifyFile } from "@/components/mobile/FileRow";
import { createLimiter } from "@/lib/mobile-thumbnails";

/**
 * Thumbnails for the desktop Inbox — the phone's pipeline minus QuickLook,
 * which the desktop does not have.
 *
 *   image   → the file itself through the asset protocol (no read, no blob)
 *   pdf     → first page rendered by pdf.js, loaded only when a PDF appears
 *   html    → the capture's inlined lead image, read natively (`article_lead_image`)
 *   other   → no picture; the row shows the type icon
 *
 * Results are promises cached by path + mtime, so a re-render is free and a
 * rewritten file (the image sweep, an update from source) regenerates. At
 * most two generations run at once — the list mounts dozens of rows in one
 * frame and pdf.js on the main thread would otherwise stall the scroll.
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

const cache = new Map<string, Promise<DesktopThumbnail>>();
const limiter = createLimiter(2);

function cacheKey(entry: FileEntry): string {
  return `${entry.path}@${entry.modified ?? 0}`;
}

async function build(entry: FileEntry): Promise<DesktopThumbnail> {
  const kind = classifyFile(entry.name);
  try {
    if (kind === "image") {
      return { kind: "picture", url: convertFileSrc(entry.path) };
    }
    if (kind === "html") {
      const bytes = await tauriApi.articleLeadImage(entry.path);
      const blob = new Blob([bytes.slice().buffer], { type: sniffImageMime(bytes) });
      return { kind: "picture", url: URL.createObjectURL(blob) };
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

export function getDesktopThumbnail(entry: FileEntry): Promise<DesktopThumbnail> {
  const key = cacheKey(entry);
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = limiter(() => build(entry));
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
