// Wiring guard for the editor image-drop hook (deep-review batch 5a).
//
// `useEditorImageDrop` shipped fully tested but was never mounted by any
// component — the classic "complete hook, zero call sites" failure mode.
// Mounting the full Editor component in jsdom requires an impractical mock
// surface (Tiptap, viewers, a dozen stores), so this guard follows the
// `no-tree-overlay.test.ts` precedent and asserts the wiring at the source
// level: Editor.tsx must import the hook and mount it with the editor
// instance and the scroll-area container ref.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EDITOR_SRC = join(__dirname, "..", "Editor.tsx");

describe("Editor image-drop wiring", () => {
  const source = readFileSync(EDITOR_SRC, "utf-8");

  it("imports useEditorImageDrop", () => {
    expect(source).toMatch(
      /import \{ useEditorImageDrop \} from ["']@\/hooks\/useEditorImageDrop["']/,
    );
  });

  it("mounts the hook with the editor instance and the scroll-area ref", () => {
    expect(source).toMatch(/useEditorImageDrop\(editor, scrollAreaRef\)/);
  });
});
