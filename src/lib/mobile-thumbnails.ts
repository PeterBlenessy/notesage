/**
 * Gallery-view thumbnail generation for the iOS library listing (#633).
 *
 * A card's thumbnail comes from one of three sources, dispatched by
 * `classifyFile`: markdown/text notes render the first ~10 lines of source
 * through the same trusted comrak pipeline the Reader uses (safe to inject —
 * see `renderMarkdownFragment`'s doc comment); anything the system can
 * preview — images, PDFs, video, office docs, HTML — goes to
 * QLThumbnailGenerator off-thread; and the web pipeline (blob decode for
 * images, a lazily-imported first-page canvas rasterizer for PDFs, so
 * pdfjs-dist never loads for a folder with no PDFs) remains as the fallback
 * for builds without the native layer. Everything else (directories,
 * unsupported types) resolves to a generic icon with no read at all.
 *
 * Two safeguards keep a folder with hundreds of notes from bursting reads:
 * `getThumbnail` is the only entry point cards call, and it (a) runs the
 * actual read+render through a shared concurrency limiter, and (b) caches
 * the resulting promise by file path so a card that re-enters the viewport
 * never re-fetches. Callers (GalleryCard) are additionally expected to only
 * call `getThumbnail` once a card is actually visible.
 */
import { iosReadFile, iosReadBinary, iosThumbnail, iosArticleThumbnail } from "@/lib/ios-api";
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

/**
 * Longest edge for a gallery thumbnail, in device pixels.
 *
 * The lead image is stored at the user's capture setting (1600 by default) —
 * right for reading, absurd for a card roughly 120pt wide. Holding fifty
 * full-size images and letting the browser scale each one down at paint time
 * is memory spent to look identical.
 */
const THUMBNAIL_MAX_EDGE = 480;

/**
 * Shrink an image to card size, when the platform can do it off the main
 * thread. `createImageBitmap` with `resizeWidth` decodes AT the target size
 * rather than decoding fully and then scaling.
 *
 * Returns the original bytes unchanged wherever this is not available (jsdom,
 * older WebKit) — a correct big image beats a failed small one.
 */
async function shrinkForCard(bytes: Uint8Array, mime: string): Promise<Blob> {
  const original = new Blob([bytes.slice().buffer], { type: mime });
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    return original;
  }
  try {
    const probe = await createImageBitmap(original);
    const longest = Math.max(probe.width, probe.height);
    if (longest <= THUMBNAIL_MAX_EDGE) {
      probe.close();
      return original;
    }
    const scale = THUMBNAIL_MAX_EDGE / longest;
    const w = Math.max(1, Math.round(probe.width * scale));
    const h = Math.max(1, Math.round(probe.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      probe.close();
      return original;
    }
    ctx.drawImage(probe, 0, 0, w, h);
    probe.close();
    return await canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
  } catch {
    return original;
  }
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
  isStale: () => boolean,
): Promise<ThumbnailResult> {
  if (entry.is_directory) return { kind: "icon" };
  const kind = classifyFile(entry.name);
  // Every await below is an abort checkpoint: a rapid folder in-and-out
  // must stop an in-flight job at its NEXT stage, not let a started
  // read→parse→render chain run to completion while the fresh folder's
  // jobs (and even its listing paint) wait behind it.
  try {
    if (kind === "markdown" || kind === "text") {
      const raw = await iosReadFile(entry.path);
      if (isStale()) throw new ThumbnailCancelled();
      const preview = extractPreviewSource(raw);
      const html = await renderMarkdownFragment(preview, opts.theme);
      return { kind: "markdown", html };
    }
    // A saved article is recognised by its PHOTO, not by its layout.
    //
    // QuickLook renders the page into a square, which is accurate and useless:
    // nobody remembers a layout, and a wall of miniature pages is unreadable.
    // What sticks is the image from the share sheet — and the sweep has
    // already embedded it in the document, so it costs one read to find.
    //
    // It also sidesteps the theme problem for free. QuickLook renders in its
    // own light trait context with no appearance parameter available, so an
    // HTML thumbnail was always light in a dark app; a photograph has no
    // theme.
    //
    // Falls through to QuickLook when the article has no inline image — an
    // unswept capture, an image-less piece, or a plain HTML file the user put
    // in the library themselves.
    if (kind === "html") {
      try {
        const bytes = await iosArticleThumbnail(entry.path);
        if (isStale()) throw new ThumbnailCancelled();
        const blob = await shrinkForCard(bytes, "image/jpeg");
        if (isStale()) throw new ThumbnailCancelled();
        return { kind: "image", url: URL.createObjectURL(blob) };
      } catch (err) {
        if (err instanceof ThumbnailCancelled) throw err;
      }
    }
    if (
      kind === "image" ||
      kind === "pdf" ||
      kind === "media" ||
      kind === "doc" ||
      kind === "html"
    ) {
      // Native first: QLThumbnailGenerator renders PDFs, images, videos,
      // office docs and web pages OFF the webview thread — no multi-MB reads
      // over IPC, no pdf.js raster on the main thread. The web pipeline below
      // survives only as the fallback for builds without the native layer.
      //
      // `html` is here rather than on the markdown path on purpose. Feeding an
      // HTML file to `renderMarkdownFragment` yields an EMPTY thumbnail, not a
      // wrong one: that pipeline runs comrak without `unsafe_`, which strips
      // raw HTML by design — the property the Reader's safety rests on. So a
      // web page can only be previewed by something that actually renders it,
      // and QuickLook already does, off-thread. Before this, `html` matched no
      // branch at all and fell through to the generic icon — invisible while
      // HTML files were rare, obvious once article capture (#612) started
      // producing folders of them.
      try {
        const png = await iosThumbnail(entry.path, 480);
        if (isStale()) throw new ThumbnailCancelled();
        // Already generated at 480 by the OS, so no shrink needed.
        const blob = new Blob([png.slice().buffer], { type: "image/png" });
        return { kind: "image", url: URL.createObjectURL(blob) };
      } catch (err) {
        if (err instanceof ThumbnailCancelled) throw err;
        // Fall through to the web pipeline (desktop dev, tests).
      }
    }
    if (kind === "image") {
      const bytes = await iosReadBinary(entry.path);
      if (isStale()) throw new ThumbnailCancelled();
      // A library photo can be many megapixels; a card is 120pt.
      const blob = await shrinkForCard(bytes, imageMimeFor(entry.name));
      if (isStale()) throw new ThumbnailCancelled();
      return { kind: "image", url: URL.createObjectURL(blob) };
    }
    if (kind === "pdf") {
      const bytes = await iosReadBinary(entry.path);
      if (isStale()) throw new ThumbnailCancelled();
      const { renderPdfThumbnailDataUrl } = await import("./mobile-pdf-thumbnail");
      const url = await renderPdfThumbnailDataUrl(bytes, undefined, isStale);
      return { kind: "pdf", url };
    }
  } catch (err) {
    // Any failure while stale counts as cancellation (evicted for retry) —
    // otherwise a stale-aborted pdf.js run would be cached as an icon
    // forever. Genuine failures (placeholder not downloaded, corrupt file)
    // on a LIVE epoch still degrade to the generic icon.
    if (err instanceof ThumbnailCancelled || isStale()) throw new ThumbnailCancelled();
    return { kind: "icon" };
  }
  return { kind: "icon" };
}

/**
 * Cached by THEME AND PATH, not path alone.
 *
 * Two things went wrong with a path-only key. React runs effects child-first,
 * so a gallery card's first thumbnail request can fire before ThemeProvider's
 * effect has put `dark` on the documentElement — the card reads "light",
 * generates a light thumbnail, and caches it for the session. And a theme flip
 * mid-session left every already-generated thumbnail in the old theme.
 *
 * Keying on the pair makes both self-correcting: a request under a different
 * theme is simply a miss.
 */
const cache = new Map<string, Promise<ThumbnailResult>>();

function cacheKey(theme: "light" | "dark", path: string): string {
  return `${theme}:${path}`;
}

/**
 * Release a cached entry's blob URL when it leaves the cache.
 *
 * `URL.createObjectURL` pins the blob until it is revoked. Dropping a cache
 * entry without revoking leaks the whole image for the session — invisible,
 * and worst exactly where it matters most: the sweep rewrites documents and
 * evicts their thumbnails, so the more articles it processes the more images
 * are stranded.
 */
async function releaseEntry(promise: Promise<ThumbnailResult> | undefined): Promise<void> {
  if (!promise) return;
  try {
    const result = await promise;
    if (result.kind === "image" || result.kind === "pdf") {
      // Data URIs (the pdf.js fallback) are plain strings with nothing to free.
      if (result.url.startsWith("blob:")) URL.revokeObjectURL(result.url);
    }
  } catch {
    // A rejected entry never produced a URL.
  }
}

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
  const key = cacheKey(opts.theme, entry.path);
  const cached = cache.get(key);
  if (cached) return cached;
  const myEpoch = epoch;
  const isStale = () => myEpoch !== epoch;
  const promise = thumbnailLimiter(async () => {
    if (isStale()) throw new ThumbnailCancelled();
    await yieldToUi();
    if (isStale()) throw new ThumbnailCancelled();
    return buildThumbnail(entry, opts, isStale);
  }).catch((err) => {
    if (err instanceof ThumbnailCancelled) {
      void releaseEntry(cache.get(key));
      cache.delete(key);
      return { kind: "icon" } as ThumbnailResult;
    }
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

/**
 * Forget one path's cached thumbnail so the next view regenerates it.
 *
 * The cache is keyed by path and never expires, which is right while a file's
 * content is fixed — but the image sweep REWRITES documents in place. Without
 * this, an article that just gained embedded images would keep showing the
 * text-only thumbnail generated before the sweep, for the rest of the session,
 * and the fix would look like it had not worked.
 */
export function evictThumbnail(path: string): void {
  // Both themes: the file's CONTENT changed, which invalidates every rendering
  // of it, not just the one currently on screen.
  for (const theme of ["light", "dark"] as const) {
    const key = cacheKey(theme, path);
    void releaseEntry(cache.get(key));
    cache.delete(key);
  }
}

/** Test-only reset — the cache is module-level and otherwise leaks across tests. */
export function resetThumbnailCache(): void {
  for (const entry of cache.values()) void releaseEntry(entry);
  cache.clear();
}
