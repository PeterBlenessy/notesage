import type { Editor } from "@tiptap/core";

/**
 * Typed interfaces for Tiptap editor.storage slots.
 * Use `getEditorStorage<T>(editor, key)` instead of `(editor.storage as any).key`.
 */

/** Storage shape for the LocalImage / Image extension. */
export interface EditorStorageImage {
  documentDir?: string;
  openInsertDialog?: () => void;
}

/** Storage shape for the tiptap-markdown extension. */
export interface EditorStorageMarkdown {
  getMarkdown?: () => string;
  parser?: {
    parse: (content: string) => string;
  };
}

/**
 * Type-safe accessor for `editor.storage[key]`.
 *
 * Returns `T | undefined` — the caller must null-check the result.
 *
 * @example
 * const imageStorage = getEditorStorage<EditorStorageImage>(editor, 'image');
 * if (imageStorage) {
 *   imageStorage.documentDir = '/some/path';
 * }
 */
export function getEditorStorage<T>(
  editor: Editor,
  key: string
): T | undefined {
  return (editor.storage as unknown as Record<string, unknown>)[key] as T | undefined;
}
