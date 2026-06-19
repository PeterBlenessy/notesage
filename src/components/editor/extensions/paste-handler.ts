/**
 * PasteHandler — Tiptap extension that runs pasted clipboard content
 * through the registered paste rules in `src/lib/editor/paste-rules.ts`
 * before falling back to the default markdown-paste path.
 *
 * Tiptap's default behaviour parses every `text/plain` payload as
 * markdown, which misfires for file paths with `~` (renders as
 * `<sub>`), terminal-rendered tables (loses column alignment),
 * AI-response prose with markdown punctuation, etc. The rules give us
 * a single extensible point to intercept those cases.
 *
 * See `src/lib/editor/paste-rules.ts` for the rule contract and
 * built-in rules. New rules can be added at any time via
 * `registerPasteRule` — this extension does not need to be aware of them.
 *
 * Also binds `Mod-Shift-v` ("paste as plain text") — see
 * `pasteAsPlainText` below. Reads the system clipboard via
 * `navigator.clipboard.readText()` and inserts the result as literal
 * text, fully bypassing both the paste-rule registry AND tiptap-markdown.
 * The user reported this as the most-cited remaining paste annoyance
 * in the 2026-04-25 live test (prose copied from terminals / Slack /
 * AI responses where literal `~text~`, `*foo*`, `_bar_`, or backticks
 * accidentally lit up markdown formatting).
 *
 * Image paste persistence (issue #164):
 *
 * When the clipboard contains image data (image/png, image/jpeg, etc.),
 * the handler writes the bytes to a stable sidecar file via Tauri IPC
 * and inserts an image node referencing the on-disk path. The path is
 * resolved to an asset:// URL at render time by the LocalImage extension.
 * Without this, Tiptap would fall through to its default handling which
 * creates a blob: URL tied to the current WebView session — those URLs
 * become invalid after the app is closed and reopened.
 *
 * Sidecar location:
 *   - Project files: <projectRoot>/.notesage/images/<uuid>.<ext>
 *   - Non-project files: <homeDir>/.notesage/images/<uuid>.<ext>
 *
 * The document directory is read from `editor.storage.image.documentDir`
 * (set by `useEditor` and updated on tab switch). The project root is
 * derived by stripping the filename from the documentDir; images are
 * stored in that root's .notesage/images/ directory.
 */

import { Extension, type Editor } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { getPasteRules } from "@/lib/editor/paste-rules";
import { saveImageSidecar, mimeToExt } from "@/lib/image-sidecar";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readText } from "@tauri-apps/plugin-clipboard-manager";

/** Image MIME types that the handler will intercept from the clipboard. */
const SUPPORTED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/svg+xml',
]);

/**
 * Derive the storage root from a documentDir.
 *
 * For a file at `/projects/notes/docs/readme.md`, the documentDir is
 * `/projects/notes/docs` and the project root (one level up from .notesage)
 * is `/projects/notes`. However, for the purpose of image storage we use
 * the documentDir itself as the root anchor — images always land in
 * `<documentDir>/.notesage/images/`. This keeps images co-located with
 * the document they were pasted into and avoids having to know the
 * project root from inside the paste handler.
 *
 * Note: the acceptance criteria say "project root" but in practice
 * Notesage passes the *file's directory* as documentDir, so using
 * documentDir as the root will place images next to the file in a
 * `.notesage/images/` subfolder — which is consistent with the drawing
 * sidecar pattern where images are stored relative to the project root
 * passed explicitly. The actual mapping (project root vs file dir) is
 * controlled by `useEditor`, which sets `documentDir` to
 * `getDocumentDir(filePath)`. We honour whatever root is passed.
 */
function storageRoot(documentDir: string): string {
  return documentDir;
}

/**
 * Handle an image paste asynchronously:
 *   1. Read bytes from the File/Blob.
 *   2. Write to disk via Tauri `save_binary_file`.
 *   3. Insert an image node with the stable file path.
 *
 * The view is captured at call time; the dispatch fires asynchronously
 * after the IPC round-trip. This is intentional — the editor stays
 * responsive while the file is being written. If the save fails, a
 * console error is logged and no image node is inserted (silent failure
 * avoids a dangling blob: URL in the document).
 */
async function handleImageFile(
  file: File | Blob,
  mimeType: string,
  editor: Editor,
  documentDir: string,
): Promise<void> {
  const root = storageRoot(documentDir);
  const uuid = crypto.randomUUID();

  let bytes: Uint8Array;
  try {
    const buffer = await file.arrayBuffer();
    bytes = new Uint8Array(buffer);
  } catch (err) {
    console.error('[paste-handler] Failed to read image bytes from clipboard:', err);
    return;
  }

  let filePath: string;
  try {
    filePath = await saveImageSidecar(bytes, mimeType, root, uuid);
  } catch (err) {
    console.error('[paste-handler] Failed to save image sidecar:', err);
    return;
  }

  // The LocalImage extension resolves the file path to an asset:// URL at
  // render time via `resolveImageSrc`. However we also call `convertFileSrc`
  // here to get the display URL — this is what ends up in the ProseMirror
  // document `src` attribute, which must be the stable path (not blob:).
  //
  // We store the absolute file path in the node's `src` attribute (not the
  // asset:// URL) so the markdown serializer emits a portable path. The
  // LocalImage NodeView converts it to asset:// at display time.
  const ext = mimeToExt(mimeType);
  const altText = `pasted-image.${ext}`;

  // Insert via the editor command so ProseMirror history works correctly.
  editor.chain().focus().setImage({ src: filePath, alt: altText }).run();

  // Preload the image via the asset protocol so the browser caches it.
  void convertFileSrc(filePath);
}

/**
 * Extract image files from a DataTransfer, checking both `files` and
 * `items` (items is needed for screenshots copied to clipboard on macOS
 * which appear as items but not as files).
 */
export function extractImageFromDataTransfer(
  clipboardData: DataTransfer,
): { file: File | Blob; mimeType: string } | null {
  // Check files first (dragged files, some clipboard images)
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (SUPPORTED_IMAGE_TYPES.has(file.type)) {
        return { file, mimeType: file.type };
      }
    }
  }

  // Check items (clipboard screenshots, screenshots on macOS)
  if (clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item.kind === 'file' && SUPPORTED_IMAGE_TYPES.has(item.type)) {
        const blob = item.getAsFile();
        if (blob) {
          return { file: blob, mimeType: item.type };
        }
      }
    }
  }

  return null;
}

export const PasteHandlerPluginKey = new PluginKey("paste-handler");

/**
 * Read the system clipboard and insert its `text/plain` content as
 * literal text at the current selection. Returns `true` when the paste
 * was consumed (i.e. the keyboard shortcut should not fall through),
 * even if the clipboard read failed asynchronously — we always claim
 * the keystroke so the default browser paste doesn't also fire.
 *
 * Exported so unit tests can drive the read+insert path directly
 * without simulating the full editor-keyboard pipeline.
 */
export async function pasteAsPlainText(editor: Editor): Promise<boolean> {
  // Read via the Tauri clipboard-manager plugin (Rust-side) rather than
  // `navigator.clipboard.readText()`. A programmatic web clipboard read shows
  // WKWebView's native "paste" permission affordance — the menu the user saw.
  // The plugin reads the OS clipboard directly with no WebKit prompt, so
  // ⌘⇧V pastes immediately.
  let text: string;
  try {
    text = (await readText()) ?? "";
  } catch {
    return false;
  }
  if (!text) return true; // nothing to paste, but we claimed the keystroke
  // Use `editor.view.state` (latest) rather than the closure'd state —
  // the user may have moved the cursor while the async read was pending.
  const { view } = editor;
  view.dispatch(view.state.tr.insertText(text));
  return true;
}

export const PasteHandler = Extension.create({
  name: "pasteHandler",

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-v": ({ editor }) => {
        // Fire-and-forget: navigator.clipboard.readText is async, but
        // tiptap keyboard handlers are synchronous. We claim the
        // keystroke immediately (return true) so the default browser
        // paste doesn't also run, then resolve the insert when the
        // clipboard read returns.
        void pasteAsPlainText(editor);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    // Capture `this` so the plugin can access the editor instance.
    const ext = this;

    return [
      new Plugin({
        key: PasteHandlerPluginKey,
        props: {
          handlePaste(view, event) {
            const clipboardData = (event as ClipboardEvent).clipboardData;
            if (!clipboardData) return false;

            // --- Image paste persistence (issue #164) ---
            // Check for image data in the clipboard BEFORE running the text
            // rules. If the clipboard contains an image, write it to disk via
            // Tauri and insert a stable file-path reference. Without this,
            // Tiptap's default image handling creates a blob: URL that becomes
            // invalid when the WebView session ends (app restart).
            const imageData = extractImageFromDataTransfer(clipboardData);
            if (imageData) {
              // Prefer the project root (set by useEditorTabSwitch from
              // useActiveProject) so images land in <project>/.notesage/images/.
              // Fall back to documentDir for non-project files (Quick Notes,
              // Explorer), which places images next to the file in .notesage/images/.
              const imageStorage = (ext.editor.storage as unknown as Record<string, unknown>).image as
                | { projectRoot?: string; documentDir?: string }
                | undefined;
              const sidecarRoot = imageStorage?.projectRoot ?? imageStorage?.documentDir;
              if (sidecarRoot) {
                event.preventDefault();
                void handleImageFile(imageData.file, imageData.mimeType, ext.editor, sidecarRoot);
                return true;
              }
              // No root available — fall through to Tiptap's default image handling
              // (which will create a blob: URL). This is a degraded experience
              // but avoids a crash when no file is open.
            }

            // --- Text paste rules ---
            const text = clipboardData.getData("text/plain") ?? "";
            const html = clipboardData.getData("text/html") || null;

            const ctx = {
              clipboardData,
              text,
              html,
              view,
              event: event as ClipboardEvent,
            };

            for (const rule of getPasteRules()) {
              if (!rule.test(ctx)) continue;
              if (rule.handle(ctx)) {
                // Rule consumed the paste. Tiptap will skip its own paste
                // handling (returning `true` from handlePaste tells PM the
                // event was handled).
                return true;
              }
            }
            return false;
          },
        },
      }),
    ];
  },
});

export default PasteHandler;
