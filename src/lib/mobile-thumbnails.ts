/**
 * Gallery-view thumbnail generation for the iOS library listing (#633).
 *
 * A card's thumbnail comes from one of three sources, dispatched by
 * `classifyFile`: markdown/text notes render the first ~10 lines of source
 * through the same trusted comrak pipeline the Reader uses (safe to inject —
 * see `renderMarkdownFragment`'s doc comment); images decode to a blob URL
 * from the already-read bytes; PDFs delegate to a lazily-imported first-page
 * canvas rasterizer (`mobile-pdf-thumbnail.ts`) so pdfjs-dist — a heavy
 * dependency — never loads for a folder with no PDFs. Everything else
 * (directories, unsupported types) resolves to a generic icon with no read
 * at all.
 *
 * Two safeguards keep a folder with hundreds of notes from bursting reads:
 * `getThumbnail` is the only entry point cards call, and it (a) runs the
 * actual read+render through a shared concurrency limiter, and (b) caches
 * the resulting promise by file path so a card that re-enters the viewport
 * never re-fetches. Callers (GalleryCard) are additionally expected to only
 * call `getThumbnail` once a card is actually visible.
 */
import { iosReadFile, iosReadBinary } from "@/lib/ios-api";
import { renderMarkdownFragment } from "@/lib/markdown-render";
import { classifyFile } from "@/components/mobile/FileRow";
import type { FileEntry } from "@/lib/tauri";

/** How many source lines of a note feed the thumbnail preview. */
const PREVIEW_LINES = 10;

/** Max simultaneous thumbnail generations across the whole gallery. Two, not
 *  more: each job is an IPC read plus render work, and the queue drains
 *  back-to-back — higher concurrency visibly starves the UI thread during
 *  navigation (Peter's frozen back-out, #633 follow-up). */
const THUMBNAIL_CONCURRENCY = 2;

/** Strip a leading YAML frontmatter block, mirroring `Reader.deriveNoteTitle`. */
export function stripFrontmatter(md: string): string {
  const fm = /^---\n[\s\S]*?\n---\n?/.exec(md);
  return fm ? md.slice(fm[0].length) : md;
}

/** The raw source fed to the thumbnail renderer: frontmatter stripped, capped
 *  at `maxLines` — cheap to render and bounded regardless of note length. */
export function extractPreviewSource(raw: string, maxLines: number = PREVIEW_LINES): string {
  return stripFrontmatter(raw).split("\n").slice(0, maxLines).join("\n");
}

export type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

/**
 * A minimal async semaphore: at most `max` functions run concurrently, the
 * rest queue FIFO and start as slots free up.
 */
export function createLimiter(max: number): Limiter {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= max) return;
    const run = queue.shift();
    if (!run) return;
    active++;
    run();
  };

  return function limited<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}

const thumbnailLimiter = createLimiter(THUMBNAIL_CONCURRENCY);

export type ThumbnailResult =
  | { kind: "markdown"; html: string }
  | { kind: "image"; url: string }
  | { kind: "pdf"; url: string }
  | { kind: "icon" };

function imageMimeFor(name: string): string {
  const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    case "bmp":
      return "image/bmp";
    default:
      return "application/octet-stream";
  }
}

async function buildThumbnail(
  entry: FileEntry,
  opts: { theme: "light" | "dark" },
): Promise<ThumbnailResult> {
  if (entry.is_directory) return { kind: "icon" };
  const kind = classifyFile(entry.name);
  try {
    if (kind === "markdown" || kind === "text") {
      const raw = await iosReadFile(entry.path);
      const preview = extractPreviewSource(raw);
      const html = await renderMarkdownFragment(preview, opts.theme);
      return { kind: "markdown", html };
    }
    if (kind === "image") {
      const bytes = await iosReadBinary(entry.path);
      const buffer = bytes.slice().buffer;
      const blob = new Blob([buffer], { type: imageMimeFor(entry.name) });
      return { kind: "image", url: URL.createObjectURL(blob) };
    }
    if (kind === "pdf") {
      const bytes = await iosReadBinary(entry.path);
      const { renderPdfThumbnailDataUrl } = await import("./mobile-pdf-thumbnail");
      const url = await renderPdfThumbnailDataUrl(bytes);
      return { kind: "pdf", url };
    }
  } catch {
    // iCloud placeholder not yet downloaded, corrupt file, pdf.js failure,
    // etc. — a card without a preview still browses fine with a generic icon.
    return { kind: "icon" };
  }
  return { kind: "icon" };
}

const cache = new Map<string, Promise<ThumbnailResult>>();

/** Bumped by `cancelPendingThumbnails`; queued jobs from an older epoch
 *  resolve to a plain icon without doing any work. */
let epoch = 0;

class ThumbnailCancelled extends Error {}

/**
 * Drop every queued-but-unstarted generation. Called when the gallery
 * unmounts (folder change, back-out, view switch): without this the queue
 * kept reading and rendering dozens of files while the parent folder tried
 * to paint — the "frozen back-out" Peter hit. The ≤2 in-flight jobs finish;
 * cancelled paths are evicted from the cache so a revisit regenerates them.
 */
export function cancelPendingThumbnails(): void {
  epoch++;
}

/** One macrotask of breathing room before each job so navigation, taps and
 *  scrolling get a frame between generations. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * The single entry point cards use. Runs the actual generation through the
 * shared concurrency limiter and caches the in-flight/resolved promise by
 * `entry.path` so repeat visibility (scroll back into view) is free.
 */
export function getThumbnail(
  entry: FileEntry,
  opts: { theme: "light" | "dark" },
): Promise<ThumbnailResult> {
  const cached = cache.get(entry.path);
  if (cached) return cached;
  const myEpoch = epoch;
  const promise = thumbnailLimiter(async () => {
    if (myEpoch !== epoch) throw new ThumbnailCancelled();
    await yieldToUi();
    if (myEpoch !== epoch) throw new ThumbnailCancelled();
    return buildThumbnail(entry, opts);
  }).catch((err) => {
    if (err instanceof ThumbnailCancelled) {
      cache.delete(entry.path);
      return { kind: "icon" } as ThumbnailResult;
    }
    throw err;
  });
  cache.set(entry.path, promise);
  return promise;
}

/** Test-only reset — the cache is module-level and otherwise leaks across tests. */
export function resetThumbnailCache(): void {
  cache.clear();
}
