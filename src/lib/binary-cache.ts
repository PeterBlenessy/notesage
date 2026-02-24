/**
 * Module-level cache for binary file data (PDF, DOCX, etc.).
 * Stored outside Zustand to keep the store lightweight.
 * Keyed by absolute file path.
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

export function clearAllBinaryData(): void {
  cache.clear();
}
