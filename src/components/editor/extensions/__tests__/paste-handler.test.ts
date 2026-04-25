/**
 * @vitest-environment jsdom
 *
 * Tests for the `pasteAsPlainText` helper used by the Cmd+Shift+V
 * keyboard shortcut on the PasteHandler extension. We exercise the
 * helper directly rather than simulating the full keyboard pipeline
 * because tiptap's `Mod-Shift-v` binding routes through
 * `addKeyboardShortcuts`, which only requires that the helper insert
 * literal text and return `true` synchronously / asynchronously.
 *
 * Live-test 2026-04-25 — added as the user-cited "smallest, zero
 * behavior risk" path to fix prose-with-markdown-punctuation paste.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { PasteHandler, pasteAsPlainText } from "../paste-handler";

const editors: Editor[] = [];

afterEach(() => {
  while (editors.length > 0) editors.pop()?.destroy();
});

function createEditor(content = "<p></p>"): Editor {
  const editor = new Editor({
    extensions: [
      StarterKit,
      Markdown.configure({ html: true }),
      PasteHandler,
    ],
    content,
  });
  editors.push(editor);
  // Place selection at end so insertText has somewhere to go.
  editor.commands.focus("end");
  return editor;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("pasteAsPlainText", () => {
  it("inserts clipboard text as literal — `~apple~` does NOT render as <sub>", async () => {
    const editor = createEditor("<p></p>");
    const readText = vi.fn(() =>
        Promise.resolve("/Users/peter/com~apple~CloudDocs/file.md"),
      );
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { readText },
    });

    const handled = await pasteAsPlainText(editor);

    expect(handled).toBe(true);
    expect(readText).toHaveBeenCalledOnce();
    // Literal text in document — no subscript / sup / em / strong marks.
    const html = editor.getHTML();
    expect(html).toContain("/Users/peter/com~apple~CloudDocs/file.md");
    expect(html).not.toContain("<sub>");
    expect(html).not.toContain("<sup>");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<strong>");
  });

  it("inserts prose with markdown punctuation as literal text", async () => {
    const editor = createEditor("<p></p>");
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        readText: vi.fn(() =>
          Promise.resolve("Try `npm install` or run *the* _foo_ ~bar~"),
        ),
      },
    });

    await pasteAsPlainText(editor);

    const html = editor.getHTML();
    expect(html).toContain("Try `npm install` or run *the* _foo_ ~bar~");
    expect(html).not.toContain("<code>");
    expect(html).not.toContain("<em>");
    expect(html).not.toContain("<strong>");
  });

  it("returns false when navigator.clipboard.readText is unavailable", async () => {
    const editor = createEditor("<p>existing</p>");
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });

    const handled = await pasteAsPlainText(editor);

    expect(handled).toBe(false);
    // Document untouched.
    expect(editor.getHTML()).toBe("<p>existing</p>");
  });

  it("returns false when clipboard read rejects (permission denied)", async () => {
    const editor = createEditor("<p>existing</p>");
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        readText: vi.fn(() =>
          Promise.reject(new DOMException("Denied", "NotAllowedError")),
        ),
      },
    });

    const handled = await pasteAsPlainText(editor);

    expect(handled).toBe(false);
    expect(editor.getHTML()).toBe("<p>existing</p>");
  });

  it("claims the keystroke even when clipboard is empty (returns true, no insert)", async () => {
    const editor = createEditor("<p>existing</p>");
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        readText: vi.fn(() => Promise.resolve("")),
      },
    });

    const handled = await pasteAsPlainText(editor);

    // Keystroke claimed (so default browser paste doesn't also fire),
    // but no text was inserted.
    expect(handled).toBe(true);
    expect(editor.getHTML()).toBe("<p>existing</p>");
  });

  it("inserts at the current selection, not an old one", async () => {
    const editor = createEditor("<p>hello world</p>");
    // Move cursor between "hello" and " world"
    editor.commands.setTextSelection(6);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: {
        readText: vi.fn(() => Promise.resolve("INSERT")),
      },
    });

    await pasteAsPlainText(editor);

    expect(editor.getHTML()).toBe("<p>helloINSERT world</p>");
  });
});

describe("Mod-Shift-v keyboard shortcut wiring", () => {
  it("registers Mod-Shift-v on the PasteHandler extension", () => {
    // Surface check — the binding must exist so tiptap's keymap picks it
    // up. Actually firing it through ProseMirror's keymap requires the
    // synthetic `KeyboardEvent` to round-trip through `prosemirror-keymap`
    // which behaves differently in jsdom vs the browser; the unit-level
    // contract we care about is "the extension declares the binding".
    const shortcuts = (PasteHandler.config.addKeyboardShortcuts as
      | (() => Record<string, unknown>)
      | undefined)?.call({});
    expect(shortcuts).toBeDefined();
    expect(shortcuts).toHaveProperty("Mod-Shift-v");
  });
});
