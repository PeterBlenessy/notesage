/**
 * useEditorImageDrop — wires OS file drag-drop to the Tiptap editor so users
 * can drag image files from Finder into the editor and have them inserted at
 * the drop position.
 *
 * Event source: HTML5 DOM drag events, NOT Tauri's `onDragDropEvent`. The app
 * ships with `dragDropEnabled: false` in tauri.conf.json (see commit 83f0fb0f
 * "disable Tauri native DnD") because the command bar, sidebar, and file-tree
 * all rely on HTML5 drag-and-drop — with Tauri's native handler enabled, the
 * webview swallows OS file drops and none of those surfaces receive them. The
 * original version of this hook listened on the (dead) Tauri event channel;
 * it now listens for DOM drops scoped to the editor container.
 *
 * Scoping / conflict guard: listeners are installed at the document capture
 * phase but only act when the event target sits inside the supplied container
 * ref. Drops on the command bar (image attachments), the sidebar (file-row
 * reordering), or anywhere else keep their current behavior untouched. Drags
 * WITHOUT OS files (e.g. sidebar rows stamped with a custom MIME) are ignored
 * even inside the editor.
 *
 * Supported image types: png, jpeg, gif, webp.
 *
 * Drop-target visual feedback: adds/removes the `editor-image-drop-target`
 * CSS class on the container element while an image-file drag is over it
 * (counter-based enter/leave tracking, same approach as the rest of the app).
 *
 * Non-image file drops on the editor: shows a `toast.error` and nothing else.
 *
 * Dropped images go through the same `compressImage` pipeline used by the
 * paste handler so they receive the same resizing and JPEG conversion.
 */

import { useEffect, type RefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { toast } from 'sonner';
import { compressImage } from '@/lib/image-compress';
import { log } from '@/lib/logger';

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const DROP_TARGET_CLASS = 'editor-image-drop-target';

function isSupportedImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(file.type);
}

/** True when the in-flight drag carries at least one OS file. */
function dragHasFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes('Files');
}

/**
 * True when the in-flight drag carries at least one image file. During drag
 * (before drop) only `items` metadata is available; when the engine doesn't
 * expose item types, fall back to "has files" so the highlight still shows.
 */
function dragHasImageFiles(dt: DataTransfer | null): boolean {
  if (!dt || !dragHasFiles(dt)) return false;
  const items = dt.items ? Array.from(dt.items) : [];
  const fileItems = items.filter((i) => i.kind === 'file');
  if (fileItems.length === 0) return true; // metadata unavailable — assume maybe-image
  return fileItems.some((i) => SUPPORTED_IMAGE_MIME_TYPES.has(i.type));
}

/**
 * Hook that listens for OS file drops on the editor container and inserts
 * dropped image files into the Tiptap editor.
 *
 * @param editor — The active Tiptap Editor instance (or null if not yet mounted).
 * @param containerRef — Ref to the editor's content container. Receives the
 *                       `editor-image-drop-target` CSS class while an image
 *                       drag is over it, and scopes which drops this hook
 *                       handles. Read live per event, so the container may
 *                       mount/unmount freely (e.g. non-markdown viewers).
 */
export function useEditorImageDrop(
  editor: Editor | null,
  containerRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    // Counter-based enter/leave tracking: dragenter/dragleave fire on every
    // element boundary inside the container, so a plain add/remove flickers.
    let dragDepth = 0;

    const container = (): HTMLElement | null => containerRef?.current ?? null;

    const insideContainer = (event: DragEvent): boolean => {
      const el = container();
      return !!el && event.target instanceof Node && el.contains(event.target);
    };

    const clearHighlight = () => {
      dragDepth = 0;
      container()?.classList.remove(DROP_TARGET_CLASS);
    };

    const handleDragEnter = (event: DragEvent) => {
      if (!insideContainer(event)) return;
      if (!dragHasImageFiles(event.dataTransfer)) return;
      dragDepth += 1;
      container()?.classList.add(DROP_TARGET_CLASS);
    };

    const handleDragOver = (event: DragEvent) => {
      if (!insideContainer(event)) return;
      if (!dragHasFiles(event.dataTransfer)) return;
      // Without preventDefault the browser never fires `drop` for file drags.
      event.preventDefault();
    };

    const handleDragLeave = (event: DragEvent) => {
      if (!insideContainer(event)) return;
      if (!dragHasImageFiles(event.dataTransfer)) return;
      dragDepth -= 1;
      if (dragDepth <= 0) clearHighlight();
    };

    const handleDragEnd = () => clearHighlight();

    const handleDrop = (event: DragEvent) => {
      if (!insideContainer(event)) {
        // A drop elsewhere still ends any drag we were highlighting.
        clearHighlight();
        return;
      }
      clearHighlight();

      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return; // not an OS file drop — leave it alone

      // This is an OS file drop on the editor — claim it before ProseMirror's
      // own drop handling sees it.
      event.preventDefault();
      event.stopPropagation();

      if (!editor || editor.isDestroyed) return;

      const allFiles = Array.from(files);
      const imageFiles = allFiles.filter(isSupportedImageFile);

      if (imageFiles.length === 0) {
        toast.error(
          'File type not supported. Only images (.png, .jpg, .gif, .webp) can be dropped into the editor.',
        );
        return;
      }

      // Insert at the drop position when the live editor view can resolve the
      // coordinates; fall back to the current selection otherwise.
      const coords = { left: event.clientX, top: event.clientY };

      void (async () => {
        for (const file of imageFiles) {
          try {
            // Same compress pipeline as paste (resize + JPEG conversion).
            const attachment = await compressImage(file, { name: file.name });
            const node = {
              type: 'image',
              attrs: {
                src: `data:${attachment.mimeType};base64,${attachment.data}`,
              },
            };

            const pos = editor.view?.posAtCoords?.(coords)?.pos;
            if (typeof pos === 'number') {
              editor.chain().focus().insertContentAt(pos, node).run();
            } else {
              editor.chain().focus().insertContent(node).run();
            }
          } catch (err) {
            log.error('editor', `Failed to insert dropped image: ${file.name}`, err);
            toast.error(`Failed to insert image: ${file.name}`);
          }
        }
      })();
    };

    // Capture phase so the editor claims image-file drops before ProseMirror's
    // own DOM handlers run; non-file drags fall through untouched.
    document.addEventListener('dragenter', handleDragEnter, true);
    document.addEventListener('dragover', handleDragOver, true);
    document.addEventListener('dragleave', handleDragLeave, true);
    document.addEventListener('dragend', handleDragEnd, true);
    document.addEventListener('drop', handleDrop, true);

    return () => {
      document.removeEventListener('dragenter', handleDragEnter, true);
      document.removeEventListener('dragover', handleDragOver, true);
      document.removeEventListener('dragleave', handleDragLeave, true);
      document.removeEventListener('dragend', handleDragEnd, true);
      document.removeEventListener('drop', handleDrop, true);
      clearHighlight();
    };
  }, [editor, containerRef]);
}
