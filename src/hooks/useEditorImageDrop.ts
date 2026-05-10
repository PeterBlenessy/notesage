/**
 * useEditorImageDrop — wires Tauri drag-drop events to the Tiptap editor so
 * users can drag image files from Finder into the editor and have them
 * inserted at the drop position.
 *
 * Supported image extensions: .png, .jpg, .jpeg, .gif, .webp
 *
 * Drop-target visual feedback: adds/removes the `editor-image-drop-target`
 * CSS class on the supplied container element while an image drag is in
 * progress.
 *
 * Non-image files: shows a `toast.error` and does nothing else.
 *
 * Dropped images go through the same `compressImage` pipeline used by the
 * paste handler so they receive the same resizing and JPEG conversion.
 */

import { useEffect } from 'react';
import type { Editor } from '@tiptap/react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { toast } from 'sonner';
import { compressImage } from '@/lib/image-compress';
import { tauriApi } from '@/lib/tauri';

const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const DROP_TARGET_CLASS = 'editor-image-drop-target';

function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return '';
  return filePath.slice(lastDot).toLowerCase();
}

function isImagePath(filePath: string): boolean {
  return SUPPORTED_IMAGE_EXTENSIONS.has(getExtension(filePath));
}

/**
 * Hook that listens for Tauri drag-drop events and inserts dropped image files
 * into the Tiptap editor.
 *
 * @param editor  — The active Tiptap Editor instance (or null if not yet mounted).
 * @param container — Optional DOM element to receive the `editor-image-drop-target`
 *                    CSS class while a drag is in progress.
 */
export function useEditorImageDrop(
  editor: Editor | null,
  container?: HTMLElement | null,
): void {
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    async function setupListener() {
      const unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
        const { payload } = event;

        if (payload.type === 'enter') {
          // Highlight the container if any of the dragged paths are images
          if (container && payload.paths.some(isImagePath)) {
            container.classList.add(DROP_TARGET_CLASS);
          }
          return;
        }

        if (payload.type === 'leave') {
          container?.classList.remove(DROP_TARGET_CLASS);
          return;
        }

        if (payload.type === 'drop') {
          // Always remove highlight on drop
          container?.classList.remove(DROP_TARGET_CLASS);

          if (!editor || editor.isDestroyed) return;

          const { paths } = payload;

          // Validate: all paths must be images (we only support single-file drops
          // but handle multi-drop gracefully by checking the first non-image)
          const imagePaths = paths.filter(isImagePath);
          const nonImagePaths = paths.filter((p) => !isImagePath(p));

          if (nonImagePaths.length > 0 && imagePaths.length === 0) {
            // Only non-image files were dropped
            toast.error(
              `File type not supported. Only images (.png, .jpg, .gif, .webp) can be dropped into the editor.`,
            );
            return;
          }

          if (imagePaths.length === 0) {
            toast.error(
              `File type not supported. Only images (.png, .jpg, .gif, .webp) can be dropped into the editor.`,
            );
            return;
          }

          // Process each image (typically one)
          for (const imagePath of imagePaths) {
            try {
              // Read raw bytes from disk via Tauri IPC
              const bytes = await tauriApi.readBinaryFile(imagePath);

              // Determine MIME type from extension for Blob construction
              const ext = getExtension(imagePath);
              const mimeType =
                ext === '.png'
                  ? 'image/png'
                  : ext === '.gif'
                    ? 'image/gif'
                    : ext === '.webp'
                      ? 'image/webp'
                      : 'image/jpeg';

              // Convert number[] to Uint8Array → Blob
              const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });

              // Run through the same compress pipeline as paste
              const attachment = await compressImage(blob);

              // Insert into the editor
              editor
                .chain()
                .focus()
                .insertContent({
                  type: 'image',
                  attrs: {
                    src: `data:${attachment.mimeType};base64,${attachment.data}`,
                  },
                })
                .run();
            } catch (err) {
              console.error('[useEditorImageDrop] Failed to insert image:', imagePath, err);
              toast.error(`Failed to insert image: ${imagePath}`);
            }
          }
        }
      });

      unlistenFn = unlisten;
    }

    setupListener();

    return () => {
      unlistenFn?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);
}
