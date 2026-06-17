import type { exportToSvg } from "@excalidraw/excalidraw";

/** Options accepted by Excalidraw's `exportToSvg` (sans the font-inlining flag, which we force). */
export type ExportSvgOpts = Omit<Parameters<typeof exportToSvg>[0], "skipInliningFonts">;

/**
 * Export an Excalidraw scene to an `<svg>` element with font inlining DISABLED.
 *
 * Excalidraw 0.18 inlines (fetches → subsets → base64-embeds) the scene's fonts
 * by default. In Notesage's sandboxed Tauri webview that default both fails and
 * hangs:
 *
 *  - The fonts are fetched from the `esm.sh` CDN, which our CSP `font-src`
 *    (correctly) blocks — so the fetch can never succeed.
 *  - The font-subsetting Web Worker can't run there (`ReferenceError: Can't find
 *    variable: document`), so Excalidraw "falls back to the main thread" — and
 *    subsetting a multi-megabyte CJK font (Xiaolai) on the main thread freezes
 *    the entire app. This is the observed **startup hang** on a document
 *    containing drawings (`error-logs-20260617`).
 *
 * `skipInliningFonts: true` short-circuits the whole path: no CDN fetch, no
 * subsetting, no main-thread freeze. Drawing text renders with the fonts already
 * available in the environment. All Notesage SVG exports (inline preview, sidecar
 * preview, PDF/DOCX/PPTX/HTML export) MUST go through this wrapper so the policy
 * can never drift back to the hanging default.
 *
 * The `@excalidraw/excalidraw` import is dynamic (the package is large and
 * code-split); the top-level `import type` is erased at build time and does not
 * pull it into the main bundle.
 */
export async function exportDrawingToSvg(opts: ExportSvgOpts): Promise<SVGSVGElement> {
  const { exportToSvg } = await import("@excalidraw/excalidraw");
  return exportToSvg({ ...opts, skipInliningFonts: true });
}
