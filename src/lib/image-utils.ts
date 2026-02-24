import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Resolves an image `src` to a URL the webview can load.
 *
 * - Remote URLs (`http://`, `https://`, `data:`) → returned unchanged.
 * - Absolute file paths (`/Users/...`) → converted via Tauri asset protocol.
 * - Relative paths (`./images/photo.png`, `images/photo.png`) → resolved
 *   against `documentDir`, then converted via Tauri asset protocol.
 *
 * Returns the original `src` if `documentDir` is not provided and the path is relative.
 */
export function resolveImageSrc(src: string, documentDir?: string): string {
  if (!src) return src;

  // Remote URLs and data URIs — pass through unchanged
  if (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:")
  ) {
    return src;
  }

  // Already an asset URL — pass through
  if (src.startsWith("asset:") || src.startsWith("http://asset.localhost")) {
    return src;
  }

  // Decode %20 → spaces (from encodeImagePathSpaces) before resolving,
  // since convertFileSrc expects a real filesystem path.
  const decoded = src.replace(/%20/g, " ");

  // Absolute file path
  if (decoded.startsWith("/")) {
    return convertFileSrc(decoded);
  }

  // Relative path — resolve against document directory
  if (documentDir) {
    // Strip leading ./ if present
    const cleanSrc = decoded.startsWith("./") ? decoded.slice(2) : decoded;
    const absolutePath = `${documentDir}/${cleanSrc}`;
    return convertFileSrc(absolutePath);
  }

  // Cannot resolve relative path without documentDir
  return src;
}

/**
 * Extracts the directory part of a file path.
 * e.g. `/Users/me/docs/note.md` → `/Users/me/docs`
 */
export function getDocumentDir(filePath: string): string {
  const lastSlash = filePath.lastIndexOf("/");
  return lastSlash > 0 ? filePath.slice(0, lastSlash) : filePath;
}
