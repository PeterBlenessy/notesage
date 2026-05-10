/**
 * Image sidecar utilities — persist pasted image bytes to a stable
 * on-disk path so they survive across app restarts.
 *
 * Storage layout (mirrors the drawing sidecar pattern):
 *   <projectRoot>/.notesage/images/<uuid>.<ext>   (project files)
 *   ~/.notesage/images/<uuid>.<ext>                (non-project / Quick Notes)
 *
 * The caller supplies the `projectRoot` (which is always an absolute
 * path — either the owning project's root or the user's home directory
 * when the file is outside any project). The returned value is an
 * absolute filesystem path that can be passed to `convertFileSrc` to
 * obtain a stable `asset://` URL for the Tiptap image node.
 *
 * Related acceptance criteria (issue #164):
 *   - Pasting an image writes bytes to a stable sidecar path and updates
 *     the markdown reference to the persistent asset:// URI.
 *   - Project files → <project>/.notesage/images/<uuid>.<ext>
 *   - Non-project files → ~/.notesage/images/<uuid>.<ext>
 *   - The path falls within the existing assetProtocol.scope.allow ($HOME)
 *     so no new Tauri capability entries are required.
 */

import { tauriApi } from '@/lib/tauri';

const IMAGES_SUBDIR = '.notesage/images';

/** Maps MIME type → file extension. Falls back to `png` for unknowns. */
const MIME_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

/**
 * Returns the extension string for a given image MIME type.
 * Falls back to `'png'` for unrecognised types.
 */
export function mimeToExt(mimeType: string): string {
  return MIME_TO_EXT[mimeType] ?? 'png';
}

/** Returns the absolute path to the images sidecar directory for a given root. */
export function imagesDir(root: string): string {
  return `${root}/${IMAGES_SUBDIR}`;
}

/**
 * Returns the absolute path for a specific image sidecar file.
 *
 * @param root       Absolute project root (or home dir for non-project files).
 * @param imageId    Unique identifier for this image (UUID).
 * @param ext        File extension without leading dot (e.g. `'png'`, `'jpeg'`).
 */
export function imagePath(root: string, imageId: string, ext: string): string {
  return `${imagesDir(root)}/${imageId}.${ext}`;
}

/**
 * Ensures the `.notesage/images/` directory hierarchy exists,
 * creating `.notesage/` and `.notesage/images/` as needed.
 */
async function ensureImagesDir(root: string): Promise<void> {
  const dir = imagesDir(root);
  const dirExists = await tauriApi.pathExists(dir);
  if (!dirExists) {
    const notesageDir = `${root}/.notesage`;
    const notesageDirExists = await tauriApi.pathExists(notesageDir);
    if (!notesageDirExists) {
      await tauriApi.createDirectory(notesageDir);
    }
    await tauriApi.createDirectory(dir);
  }
}

/**
 * Save image bytes to a sidecar file and return the absolute path.
 *
 * @param bytes      Raw image bytes (e.g. from a File or Blob).
 * @param mimeType   MIME type string (e.g. `'image/png'`).
 * @param root       Absolute project root (or home dir for non-project files).
 * @param imageId    UUID for the image — caller supplies this so tests can be deterministic.
 *
 * @returns Absolute filesystem path to the saved file.
 */
export async function saveImageSidecar(
  bytes: Uint8Array,
  mimeType: string,
  root: string,
  imageId: string,
): Promise<string> {
  await ensureImagesDir(root);

  const ext = mimeToExt(mimeType);
  const outPath = imagePath(root, imageId, ext);

  await tauriApi.saveBinaryFile(outPath, Array.from(bytes));

  return outPath;
}
