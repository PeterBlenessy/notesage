/**
 * The debounced markdown serialize behind `useEditor`'s `onUpdate`.
 *
 * Serializing a large document on every keystroke is expensive, so an edit
 * only schedules it. ONE editor instance is reused for every document, which
 * makes the pending serialize dangerous across a document switch: it reads
 * whatever the editor holds when it runs. So each pending entry is bound to
 * the document it was scheduled for, and the switch pipeline flushes it
 * before loading the next document (audit 2026-11-22 §2).
 *
 * Lives outside `useEditor.ts` so `useEditorTabSwitch` can flush without
 * importing the whole extension graph.
 */
import type { Editor } from "@tiptap/core";
import { getMarkdownFromEditor } from "@/lib/markdown";

/** Debounce for markdown serialization after an edit. */
export const SERIALIZE_DEBOUNCE_MS = 150;

interface PendingSerialize {
  timer: ReturnType<typeof setTimeout>;
  /** The document the pending edit belongs to, captured when it was made. */
  documentId: string | null;
  onUpdate: (content: string, documentId: string | null) => void;
}

// One pending serialize per editor instance. Keyed by the editor rather than
// held in a single module-level timer so `useEditorTabSwitch` can flush it for
// the editor it is about to load another document into.
const pendingSerializes = new WeakMap<Editor, PendingSerialize>();

export function scheduleSerialize(
  editor: Editor,
  onUpdate: (content: string, documentId: string | null) => void,
  documentId: string | null,
): void {
  // Replaces any pending entry. If that entry was for ANOTHER document (the
  // switch pipeline flushes before it loads, so it should not be) it is
  // dropped, not flushed: the editor no longer holds that document.
  const existing = pendingSerializes.get(editor);
  if (existing) clearTimeout(existing.timer);
  const timer = setTimeout(() => flushPendingSerialize(editor), SERIALIZE_DEBOUNCE_MS);
  pendingSerializes.set(editor, { timer, documentId, onUpdate });
}

/**
 * Run the editor's pending debounced serialize now, if there is one.
 *
 * MUST be called before another document's content is loaded into the editor:
 * the serialize reads whatever the editor holds when it runs, so a timer left
 * pending across a document switch would write the NEW document's markdown
 * under the OLD document's id (audit 2026-11-22 §2).
 */
export function flushPendingSerialize(editor: Editor): void {
  const pending = pendingSerializes.get(editor);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingSerializes.delete(editor);
  if (editor.isDestroyed) return;
  pending.onUpdate(getMarkdownFromEditor(editor), pending.documentId);
}
