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

import { PasteHandler, pasteAsPlainText, extractImageFromDataTransfer } from "../paste-handler";

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

// ---------------------------------------------------------------------------
// extractImageFromDataTransfer — issue #164 image paste persistence
// ---------------------------------------------------------------------------

describe("extractImageFromDataTransfer", () => {
  it("returns null when no image data is present", () => {
    const dt = makeDataTransfer({ files: [], items: [] });
    expect(extractImageFromDataTransfer(dt)).toBeNull();
  });

  it("detects image/png from files list", () => {
    const blob = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    const file = new File([blob], "screenshot.png", { type: "image/png" });
    const dt = makeDataTransfer({ files: [file], items: [] });
    const result = extractImageFromDataTransfer(dt);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
    expect(result!.file).toBe(file);
  });

  it("detects image/jpeg from files list", () => {
    const file = new File([], "photo.jpg", { type: "image/jpeg" });
    const dt = makeDataTransfer({ files: [file], items: [] });
    const result = extractImageFromDataTransfer(dt);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/jpeg");
  });

  it("detects image from items when files list is empty (clipboard screenshot)", () => {
    const blob = new Blob([new Uint8Array([0, 1, 2])], { type: "image/png" });
    const item: Partial<DataTransferItem> = {
      kind: "file",
      type: "image/png",
      getAsFile: () => blob as unknown as File,
    };
    const dt = makeDataTransfer({ files: [], items: [item as DataTransferItem] });
    const result = extractImageFromDataTransfer(dt);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe("image/png");
  });

  it("skips non-image items", () => {
    const item: Partial<DataTransferItem> = {
      kind: "string",
      type: "text/plain",
      getAsFile: () => null,
    };
    const dt = makeDataTransfer({ files: [], items: [item as DataTransferItem] });
    expect(extractImageFromDataTransfer(dt)).toBeNull();
  });

  it("returns null when getAsFile returns null for image item", () => {
    const item: Partial<DataTransferItem> = {
      kind: "file",
      type: "image/png",
      getAsFile: () => null,
    };
    const dt = makeDataTransfer({ files: [], items: [item as DataTransferItem] });
    // item has kind=file + supported type but getAsFile returns null
    expect(extractImageFromDataTransfer(dt)).toBeNull();
  });

  it("skips unsupported image/* types (e.g. image/tiff)", () => {
    const file = new File([], "scan.tiff", { type: "image/tiff" });
    const dt = makeDataTransfer({ files: [file], items: [] });
    expect(extractImageFromDataTransfer(dt)).toBeNull();
  });

  it("detects image/gif", () => {
    const file = new File([], "anim.gif", { type: "image/gif" });
    const dt = makeDataTransfer({ files: [file], items: [] });
    expect(extractImageFromDataTransfer(dt)?.mimeType).toBe("image/gif");
  });

  it("detects image/webp", () => {
    const file = new File([], "photo.webp", { type: "image/webp" });
    const dt = makeDataTransfer({ files: [file], items: [] });
    expect(extractImageFromDataTransfer(dt)?.mimeType).toBe("image/webp");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDataTransfer({
  files,
  items,
}: {
  files: File[];
  items: DataTransferItem[];
}): DataTransfer {
  // Build indexed FileList-like without spreading `length` (which causes
  // TS2783 duplicate property error when spreading an array into an object).
  const fileListLike: Record<string | number, unknown> = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
  };
  files.forEach((f, i) => { fileListLike[i] = f; });

  const itemListLike: Record<string | number, unknown> = {
    length: items.length,
  };
  items.forEach((it, i) => { itemListLike[i] = it; });

  return {
    files: fileListLike as unknown as FileList,
    items: itemListLike as unknown as DataTransferItemList,
    getData: (_type: string) => "",
    setData: () => {},
    clearData: () => {},
    types: [],
    dropEffect: "none",
    effectAllowed: "none",
  } as unknown as DataTransfer;
}
