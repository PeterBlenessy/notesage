/**
 * editor-events — cross-component event bus for "tell the editor to do X"
 * intents that don't fit the React prop/store model (because the editor's
 * ProseMirror instance is a singleton across tabs and the requesters
 * are siblings).
 *
 * Today this exposes one event:
 *
 *   - `notesage:focus-editor` — move keyboard focus to the editor's
 *     contenteditable. Used after an inline-create flow opens a new
 *     tab so the cursor lands in the editor instead of falling to
 *     body when the trigger element unmounts. Listener lives in
 *     `Editor.tsx`; emitters call `dispatchFocusEditor()`.
 *
 * Add new intents here rather than spreading `window.dispatchEvent`
 * call sites with raw string literals.
 */

export const FOCUS_EDITOR_EVENT = 'notesage:focus-editor';

/**
 * Ask the active editor to take keyboard focus on the next tick. No-op
 * if the Editor isn't currently mounted (the listener simply won't
 * fire). Idempotent; safe to call multiple times in a row — the
 * editor will end up focused either way.
 */
export function dispatchFocusEditor(): void {
  window.dispatchEvent(new Event(FOCUS_EDITOR_EVENT));
}
