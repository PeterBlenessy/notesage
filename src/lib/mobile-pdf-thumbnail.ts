/**
 * Renders the first page of a PDF (already-read bytes) to a small raster
 * thumbnail for the gallery view (#633). Isolated in its own module and
 * dynamically imported by `mobile-thumbnails.ts` so pdfjs-dist — a heavy
 * dependency — is never pulled into the gallery bundle for a folder with no
 * PDFs, mirroring how the Reader lazy-loads the full `PdfViewer`.
 *
 * Not unit-tested at the pixel level: jsdom has no `<canvas>` 2D context
 * without the (uninstalled) `canvas` npm package — the same constraint that
 * already leaves the desktop `PdfViewer`'s own render pipeline untested.
 * Dispatch behavior (a PDF entry reaches this function with the right bytes)
 * is covered in `mobile-thumbnails.test.ts` via a module mock.
 */
import * as pdfjsLib from "pdfjs-dist";

// Same WKWebView custom-scheme worker workaround as PdfViewer.tsx: a plain
// http(s)/file worker URL silently falls back to pdf.js's main-thread "fake
// worker" under a custom scheme, which would block the UI thread for every
// thumbnail. Fetching the bundled worker script and handing pdf.js a blob:
// URL sidesteps the restriction; the direct URL is kept as the fallback for
// contexts where fetch fails (dev server, tests) — those spawn workers fine.
const pdfWorkerUrl = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
let workerBlobReady: Promise<void> | null = null;
function ensureBlobWorker(): Promise<void> {
  workerBlobReady ??= fetch(pdfWorkerUrl)
    .then(async (res) => {
      if (!res.ok) return;
      const blob = await res.blob();
      pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(
        new Blob([blob], { type: "text/javascript" }),
      );
    })
    .catch(() => {});
  return workerBlobReady;
}

/** Rasterize page 1 of `bytes` to a PNG data URL, scaled to fit `maxWidth`. */
export async function renderPdfThumbnailDataUrl(
  bytes: Uint8Array,
  maxWidth = 240,
): Promise<string> {
  await ensureBlobWorker();
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    disableStream: true,
    disableAutoFetch: true,
  });
  try {
    const doc = await loadingTask.promise;
    const page = await doc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = maxWidth / baseViewport.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    await page.render({ canvasContext: ctx, canvas, viewport }).promise;
    return canvas.toDataURL("image/png");
  } finally {
    // `destroy()` lives on the loading task, not the resolved document proxy.
    await loadingTask.destroy();
  }
}
