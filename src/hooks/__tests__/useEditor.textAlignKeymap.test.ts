// @vitest-environment jsdom
/**
 * Regression-lock: TextAlign default keyboard shortcuts removed (issue #263).
 *
 * Cmd+Shift+E (export), Cmd+Shift+L (sidebar), and Cmd+Shift+R (recording)
 * must not be captured by the TextAlign extension when the editor has focus.
 *
 * The fix: TextAlign.extend({ addKeyboardShortcuts() { return {}; } })
 * removes the 'Mod-Shift-e/l/r' entries from the ProseMirror keymap so those
 * chords fall through to the app-level handlers in useKeyboardShortcuts.ts.
 *
 * prosemirror-keymap normalizes 'Mod-Shift-e' to 'Shift-Ctrl-e' on non-Mac.
 * jsdom sets navigator.platform to '' → mac=false → Mod=Ctrl.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM("<!DOCTYPE html><html><body></body></html>");
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement;
});

// The fixed TextAlign extension — identical to what useEditor.ts now uses.
// addKeyboardShortcuts returns {} so 'Mod-Shift-e/l/r' are not in the keymap.
const TextAlignNoShortcuts = TextAlign.extend({
  addKeyboardShortcuts() {
    return {};
  },
});

function buildEditor(): Editor {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [
      StarterKit,
      TextAlignNoShortcuts.configure({ types: ["heading", "paragraph"] }),
    ],
    content: "<p>cursor here</p>",
  });
}

describe("TextAlign keymap regression lock (issue #263)", () => {
  it("Ctrl+Shift+e does not produce a setTextAlign transaction on the paragraph", () => {
    const editor = buildEditor();

    const textAlignBefore = editor.getAttributes("paragraph").textAlign;

    // Dispatch Ctrl+Shift+e — this is 'Shift-Ctrl-e' in prosemirror-keymap
    // (Mod=Ctrl on non-Mac). With the default TextAlign config this chord
    // fires setTextAlign('center'). After the fix the chord is not registered.
    const event = new dom.window.KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "e",
      code: "KeyE",
      keyCode: 69,
      shiftKey: true,
      ctrlKey: true,
    });
    editor.view.dom.dispatchEvent(event);

    // textAlign must NOT become 'center' (setTextAlign('center')'s value).
    expect(editor.getAttributes("paragraph").textAlign).not.toBe("center");
    expect(editor.getAttributes("paragraph").textAlign).toEqual(textAlignBefore);

    editor.destroy();
  });
});
