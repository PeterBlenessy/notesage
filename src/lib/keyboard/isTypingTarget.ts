/**
 * Shared "is the user typing into something?" guard for the global shortcut
 * dispatcher. Centralizes the check that was previously duplicated in
 * `QuietLayout` (capture-phase ⌘N/⌘⇧N) and the editor key bindings.
 *
 * Returns true when the event target is a text-entry surface that should own
 * its own keystrokes: an <input>, <textarea>, or any contentEditable element
 * (which includes the ProseMirror editor and CodeMirror). Global chords that
 * carry `firesWhileTyping: true` in the manifest bypass this guard.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}
