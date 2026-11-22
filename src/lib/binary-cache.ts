/**
 * Module-level cache for binary file data (PDF, DOCX, etc.).
 * Stored outside Zustand to keep the store lightweight.
 * Keyed by absolute file path.
 *
 * Lifetime: an entry lives exactly as long as its document is open. On the
 * desktop the editor store evicts it when the document leaves
 * `openDocuments` and re-keys it on rename (see the subscription at the
 * bottom of `editor-store.ts`); the mobile Reader clears its own entry on
 * unmount. Nothing is evicted while its document is open, so a viewer never
 * sees a miss for the document it is showing.
 */
const cache = new Map<string, Uint8Array>();

export function getBinaryData(filePath: string): Uint8Array | undefined {
  return cache.get(filePath);
}

export function setBinaryData(filePath: string, data: Uint8Array): void {
  cache.set(filePath, data);
}

export function clearBinaryData(filePath: string): void {
  cache.delete(filePath);
}

/** Re-key an entry after its file was renamed or moved. No-op on a miss. */
export function moveBinaryData(oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;
  const data = cache.get(oldPath);
  if (data === undefined) return;
  cache.delete(oldPath);
  cache.set(newPath, data);
}

export function clearAllBinaryData(): void {
  cache.clear();
}
