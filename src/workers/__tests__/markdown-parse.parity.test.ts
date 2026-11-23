// @vitest-environment jsdom

/**
 * Worker ↔ main-thread parse parity.
 *
 * A document can reach the editor two ways. Small ones are parsed on the main
 * thread by tiptap-markdown (`loadRawMarkdownIntoEditor` → `setContent`).
 * Large ones are parsed in the Web Worker by a hand-assembled pipeline
 * (`parseMarkdownToProseMirrorJson`: its own markdown-it instance, linkedom,
 * ProseMirror's DOMParser) and the resulting JSON is fed to `setContent`.
 * If the two disagree, the same file opens as a different document depending
 * on its size — and the next save writes the difference back to disk.
 *
 * The worker code has always said this is "verified by Phase 2 task #19's
 * parity test". No such test existed: `markdown-parse.core.test.ts` only ever
 * compared the worker with itself. This is that test, over every round-trip
 * fixture.
 *
 * Both sides use the production worker schema (`workerExtensions`) and the
 * production preprocessor chain, so what is compared is exactly the part that
 * is implemented twice: markdown → HTML → ProseMirror.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Editor, type Extensions, type JSONContent } from "@tiptap/core";
import { Markdown } from "tiptap-markdown";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import markdownitSub from "markdown-it-sub";
import markdownitSup from "markdown-it-sup";
import { workerExtensions } from "../worker-extensions";
import { parseMarkdownToProseMirrorJson } from "../markdown-parse.core";
import { loadParsedJsonIntoEditor, loadRawMarkdownIntoEditor } from "@/lib/markdown";

const FIXTURE_DIR = resolve(__dirname, "../../../tests/fixtures");
const fixtureFiles = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".md"))
  .sort();

/**
 * The main-thread editor: the worker's own schema plus what only the main
 * thread has — the tiptap-markdown extension (configured as in `useEditor.ts`)
 * and the sub/superscript markdown-it plugins, which `useEditor.ts` registers
 * through those marks' `markdown.parse.setup` and the worker registers on its
 * markdown-it instance directly.
 */
function mainThreadExtensions(): Extensions {
  const withMarkdownIt = (plugin: unknown) => ({
    addStorage() {
      return {
        markdown: {
          parse: {
            setup(md: { use: (p: unknown) => void }) {
              md.use(plugin);
            },
          },
        },
      };
    },
  });
  return [
    ...workerExtensions.filter((ext) => ext.name !== "subscript" && ext.name !== "superscript"),
    Subscript.extend(withMarkdownIt(markdownitSub)),
    Superscript.extend(withMarkdownIt(markdownitSup)),
    Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: false, linkify: false }),
  ];
}

/**
 * Drop what legitimately differs between two parses of one document: the
 * UniqueID extension mints a fresh UUID per block per parse.
 */
function stripVolatile(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripVolatile);
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "attrs" && value && typeof value === "object") {
        const attrs: Record<string, unknown> = {};
        for (const [aKey, aValue] of Object.entries(value as Record<string, unknown>)) {
          if (aKey === "id" && (aValue === null || (typeof aValue === "string" && /^[0-9a-f-]{36}$/i.test(aValue)))) continue;
          attrs[aKey] = stripVolatile(aValue);
        }
        out[key] = attrs;
      } else {
        out[key] = stripVolatile(value);
      }
    }
    return out;
  }
  return node;
}

describe("markdown parse: worker pipeline matches the main-thread editor", () => {
  let editor: Editor;

  beforeAll(() => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: mainThreadExtensions(),
      content: "",
    });
  });

  afterAll(() => {
    editor.destroy();
  });

  /** The synchronous path: tiptap-markdown parses on the main thread. */
  const viaMainThread = (markdown: string): JSONContent => {
    loadRawMarkdownIntoEditor(editor, markdown);
    return editor.getJSON();
  };

  /**
   * The hydration path, end to end: the worker pipeline parses, and its JSON
   * goes through the same `loadParsedJsonIntoEditor` production uses. Compared
   * AFTER that load rather than straight out of the pipeline, because the
   * editor is what the user gets — schema defaults and the trailing-paragraph
   * plugin apply to both paths there.
   */
  const viaWorker = (markdown: string): JSONContent => {
    const parsed = parseMarkdownToProseMirrorJson(markdown);
    loadParsedJsonIntoEditor(editor, parsed.doc, {
      annotations: parsed.annotations,
      nodeIds: parsed.nodeIds,
      tableMetadata: parsed.tableMetadata,
    });
    return editor.getJSON();
  };

  it("has fixtures to compare", () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(10);
  });

  it("the main-thread editor here has the worker's schema", () => {
    // Same node and mark names on both sides, or the comparison below would
    // be measuring a schema difference this file introduced itself.
    const worker = new Editor({ element: document.createElement("div"), extensions: workerExtensions, content: "" });
    expect(Object.keys(editor.schema.nodes).sort()).toEqual(Object.keys(worker.schema.nodes).sort());
    expect(Object.keys(editor.schema.marks).sort()).toEqual(Object.keys(worker.schema.marks).sort());
    worker.destroy();
  });

  const expectParity = (markdown: string) => {
    const fromWorker = stripVolatile(viaWorker(markdown));
    const fromMainThread = stripVolatile(viaMainThread(markdown));
    expect(fromWorker).toEqual(fromMainThread);
  };

  // -------------------------------------------------------------------------
  // KNOWN DIVERGENCES — found by this test the first time it ran (2026-11-23).
  //
  // The worker pipeline renders with a bare markdown-it and hands the HTML
  // straight to ProseMirror. tiptap-markdown, on the main thread, normalises
  // that HTML first (its per-node `parse.updateDOM` hooks). The worker has no
  // equivalent step, so these four inputs come out differently.
  //
  // They are recorded with `it.fails` instead of being fixed here: the fix
  // belongs in `markdown-parse.core.ts`, changes what a loaded document looks
  // like, and needs checking in the running app. `it.fails` keeps this file
  // green today and turns it RED the moment one of them is fixed — at which
  // point delete the marker (and the fixture's entry below) so the fix stays
  // locked in.
  // -------------------------------------------------------------------------

  const DIVERGENCE = {
    codeBlockNewline: "fenced and indented code blocks keep markdown-it's trailing newline in their text",
    imageParagraph: "a standalone image leaves an empty paragraph before it (the `<p>` it was hoisted out of)",
    linkClass: "link marks get `class: \"\"` where the main thread gets `class: null`",
  } as const;

  it("task lists keep their items and checked state through the worker", () => {
    // Was a divergence until 2026-11-23: the worker produced plain bullets.
    expectParity("- [ ] open\n- [x] done\n");
    const json = JSON.stringify(viaWorker("- [ ] open\n- [x] done\n"));
    expect(json).toContain('"taskItem"');
    expect(json).toContain('"checked":true');
  });

  describe("each known divergence, in its smallest form", () => {
    it.fails(`code blocks: ${DIVERGENCE.codeBlockNewline}`, () => {
      expectParity("```\ncode\n```\n");
    });

    it.fails(`images: ${DIVERGENCE.imageParagraph}`, () => {
      expectParity("Before.\n\n![Alt](https://example.com/image.png)\n");
    });

    it.fails(`links: ${DIVERGENCE.linkClass}`, () => {
      expectParity("A [link](https://example.com).\n");
    });
  });

  /** Fixtures that contain one or more of the divergences above. */
  const KNOWN_DIVERGENT_FIXTURES: Record<string, ReadonlyArray<keyof typeof DIVERGENCE>> = {
    "code-blocks.md": ["codeBlockNewline"],
    "complex-document.md": ["codeBlockNewline"],
    "complex-tables.md": ["linkClass"],
    "images.md": ["imageParagraph"],
    "internal-links.md": ["linkClass"],
    "large-document.md": ["codeBlockNewline"],
    "links.md": ["linkClass"],
    "mixed-content.md": ["codeBlockNewline", "linkClass"],
    "subscript-superscript.md": ["codeBlockNewline"],
    "unicode-content.md": ["codeBlockNewline"],
    "wikilinks.md": ["linkClass"],
  };

  it("every known-divergent entry names a real fixture", () => {
    expect(Object.keys(KNOWN_DIVERGENT_FIXTURES).filter((f) => !fixtureFiles.includes(f))).toEqual([]);
  });

  describe("every round-trip fixture", () => {
    for (const file of fixtureFiles) {
      const known = KNOWN_DIVERGENT_FIXTURES[file];
      const run = () => expectParity(readFileSync(resolve(FIXTURE_DIR, file), "utf-8"));
      if (known) {
        it.fails(`${file} — known divergence: ${known.join(", ")}`, run);
      } else {
        it(file, run);
      }
    }
  });
});
