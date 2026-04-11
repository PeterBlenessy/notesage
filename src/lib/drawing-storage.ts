/**
 * Drawing storage utilities for reading, writing, and deleting
 * .excalidraw and .svg sidecar files via Tauri IPC.
 *
 * @deprecated Drawings now use inline fenced code blocks (`drawingJson` attribute)
 * instead of sidecar files. These functions are retained only for backward
 * compatibility during migration of existing documents. New drawings do not
 * create sidecar files. See PRD: docs/prds/2026-04-09-inline-attachments.md
 *
 * Drawing files are stored at:
 *   <projectRoot>/.notesage/drawings/<drawingId>.excalidraw
 *   <projectRoot>/.notesage/drawings/<drawingId>.svg
 */

import { tauriApi } from '@/lib/tauri';

const DRAWINGS_DIR = '.notesage/drawings';

function drawingsPath(projectRoot: string): string {
  return `${projectRoot}/${DRAWINGS_DIR}`;
}

function excalidrawPath(drawingId: string, projectRoot: string): string {
  return `${drawingsPath(projectRoot)}/${drawingId}.excalidraw`;
}

function svgPath(drawingId: string, projectRoot: string): string {
  return `${drawingsPath(projectRoot)}/${drawingId}.svg`;
}

/**
 * Ensures the .notesage/drawings/ directory exists, creating
 * .notesage/ and .notesage/drawings/ as needed.
 */
async function ensureDrawingsDir(projectRoot: string): Promise<void> {
  const notesageDir = `${projectRoot}/.notesage`;
  const drawingsDir = drawingsPath(projectRoot);

  const drawingsDirExists = await tauriApi.pathExists(drawingsDir);
  if (!drawingsDirExists) {
    const notesageDirExists = await tauriApi.pathExists(notesageDir);
    if (!notesageDirExists) {
      await tauriApi.createDirectory(notesageDir);
    }
    await tauriApi.createDirectory(drawingsDir);
  }
}

/**
 * Load an Excalidraw scene from disk.
 * Returns the parsed scene data, or null if the file doesn't exist.
 */
export async function loadDrawing(
  drawingId: string,
  projectRoot: string,
): Promise<unknown> {
  const filePath = excalidrawPath(drawingId, projectRoot);
  try {
    const exists = await tauriApi.pathExists(filePath);
    if (!exists) return null;

    const raw = await tauriApi.readFile(filePath);
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Save Excalidraw scene data to disk as JSON.
 * Creates the drawings directory if it doesn't exist.
 */
export async function saveDrawing(
  drawingId: string,
  projectRoot: string,
  sceneData: unknown,
): Promise<void> {
  await ensureDrawingsDir(projectRoot);
  const filePath = excalidrawPath(drawingId, projectRoot);
  await tauriApi.writeFile(filePath, JSON.stringify(sceneData, null, 2));
}

/**
 * Save an SVG preview string to disk alongside the .excalidraw file.
 * Creates the drawings directory if it doesn't exist.
 */
export async function saveSvgPreview(
  drawingId: string,
  projectRoot: string,
  svgString: string,
): Promise<void> {
  await ensureDrawingsDir(projectRoot);
  const filePath = svgPath(drawingId, projectRoot);
  await tauriApi.writeFile(filePath, svgString);
}

/**
 * Delete both the .excalidraw and .svg files for a drawing.
 * Silently ignores errors if the files don't exist.
 */
export async function deleteDrawing(
  drawingId: string,
  projectRoot: string,
): Promise<void> {
  const excalidraw = excalidrawPath(drawingId, projectRoot);
  const svg = svgPath(drawingId, projectRoot);

  try {
    await tauriApi.deletePath(excalidraw);
  } catch {
    // File may not exist — ignore
  }

  try {
    await tauriApi.deletePath(svg);
  } catch {
    // File may not exist — ignore
  }
}

/**
 * Check whether an .excalidraw file exists on disk.
 */
export async function drawingExists(
  drawingId: string,
  projectRoot: string,
): Promise<boolean> {
  const filePath = excalidrawPath(drawingId, projectRoot);
  return tauriApi.pathExists(filePath);
}

/**
 * Load the SVG preview string from disk.
 * Returns the SVG string, or null if the file doesn't exist.
 */
export async function loadSvgPreview(
  drawingId: string,
  projectRoot: string,
): Promise<string | null> {
  const filePath = svgPath(drawingId, projectRoot);
  try {
    const exists = await tauriApi.pathExists(filePath);
    if (!exists) return null;

    return await tauriApi.readFile(filePath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Excalidraw shape library persistence
// ---------------------------------------------------------------------------

const LIBRARY_FILENAME = 'excalidraw-library.json';

async function libraryFilePath(): Promise<string> {
  const home = await tauriApi.getHomeDir();
  return `${home}/.notesage/${LIBRARY_FILENAME}`;
}

async function ensureNotesageDir(): Promise<void> {
  const home = await tauriApi.getHomeDir();
  const dir = `${home}/.notesage`;
  const exists = await tauriApi.pathExists(dir);
  if (!exists) {
    await tauriApi.createDirectory(dir);
  }
}

/**
 * Load the global Excalidraw library from disk.
 * Returns the parsed library items array, or empty array if not found.
 */
export async function loadLibrary(): Promise<unknown[]> {
  try {
    const filePath = await libraryFilePath();
    const exists = await tauriApi.pathExists(filePath);
    if (!exists) return [];

    const raw = await tauriApi.readFile(filePath);
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Save the global Excalidraw library to disk.
 */
export async function saveLibrary(items: unknown[]): Promise<void> {
  await ensureNotesageDir();
  const filePath = await libraryFilePath();
  await tauriApi.writeFile(filePath, JSON.stringify(items, null, 2));
}

/**
 * Import a .excalidrawlib file and merge its items into the global library.
 * Deduplicates by `id` — existing items take priority.
 * Returns the number of newly added items.
 */
export async function importLibraryFile(filePath: string): Promise<number> {
  const raw = await tauriApi.readFile(filePath);
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const newItems = Array.isArray(parsed.libraryItems)
    ? (parsed.libraryItems as Array<Record<string, unknown>>)
    : Array.isArray(parsed)
      ? (parsed as Array<Record<string, unknown>>)
      : [];

  if (newItems.length === 0) return 0;

  const existing = await loadLibrary();
  const existingIds = new Set(
    existing
      .map((item) => (item as Record<string, unknown>).id)
      .filter(Boolean),
  );

  const toAdd = newItems.filter(
    (item) => item.id && !existingIds.has(item.id),
  );

  if (toAdd.length === 0) return 0;

  await saveLibrary([...existing, ...toAdd]);
  return toAdd.length;
}
