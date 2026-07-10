/**
 * Direct unit tests for the pure preprocessor/postprocessor helpers in
 * `markdown-html-converters.ts` — the string<->string transforms that run
 * around the Tiptap markdown round-trip and manipulate the HTML comments
 * embedded in saved markdown (node IDs, annotations, table column metadata,
 * TOC markers, image path encoding).
 *
 * These helpers guard on-disk file integrity: a bug in strip/inject/encode
 * silently corrupts markdown on save. The tests below emphasise
 * inject↔strip round-trips, idempotency, and malformed / empty-input edges.
 *
 * The `apply*ToEditor` helpers require a live ProseMirror document, so a
 * headless Tiptap editor is built (mirroring markdown-edge-cases.test.ts).
 * The editor declares the `id` attribute (UniqueID) and an `annotation`
 * attribute so the apply→inject round-trips are exercised against real
 * schema-backed nodes rather than a mock.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor, Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import UniqueID from "@tiptap/extension-unique-id";
import { Markdown } from "tiptap-markdown";

import {
  normalizeEmptyTaskItems,
  stripAnnotationsFromMarkdown,
  applyAnnotationsToEditor,
  injectAnnotationsIntoMarkdown,
  stripNodeIdComments,
  applyNodeIdsToEditor,
  injectNodeIdComments,
  extractTableColumnMetadata,
  applyTableColumnMetadata,
  convertTocToHtml,
  restoreTocComments,
  encodeImagePathSpaces,
  decodeImagePathSpaces,
} from "@/lib/markdown-html-converters";

// ---------------------------------------------------------------------------
// jsdom bootstrap — ProseMirror needs a global DOM
// ---------------------------------------------------------------------------

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="editor"></div></body></html>',
  );
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.DOMParser = dom.window.DOMParser as unknown as typeof DOMParser;
  globalThis.getComputedStyle =
    dom.window.getComputedStyle as unknown as typeof getComputedStyle;
});

// ---------------------------------------------------------------------------
// Editor factory
// ---------------------------------------------------------------------------

/**
 * Minimal extension that declares an `annotation` attribute on list items so
 * `applyAnnotationsToEditor` (which calls `tr.setNodeAttribute(pos,
 * "annotation", ...)`) actually persists onto schema-backed nodes and can be
 * read back by `injectAnnotationsIntoMarkdown`.
 */
const AnnotationAttr = Extension.create({
  name: "annotationAttr",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem", "taskItem"],
        attributes: {
          annotation: {
            default: null,
            parseHTML: () => null,
            renderHTML: () => ({}),
          },
        },
      },
    ];
  },
});

function createTestEditor(content: string): Editor {
  const el = document.createElement("div");
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      AnnotationAttr,
      UniqueID.configure({
        attributeName: "id",
        types: [
          "paragraph",
          "heading",
          "listItem",
          "taskItem",
          "blockquote",
        ],
        // Deterministic: no auto-generated IDs, so the only IDs present are the
        // ones the tests inject via applyNodeIdsToEditor.
        generateID: () => "",
      }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
        linkify: false,
      }),
    ],
    content,
    editable: true,
  });
}

function getRawMarkdown(editor: Editor): string {
  const storage = editor.storage as { markdown?: { getMarkdown(): string } };
  return storage.markdown?.getMarkdown() ?? "";
}

// ---------------------------------------------------------------------------
// normalizeEmptyTaskItems (pure)
// ---------------------------------------------------------------------------

describe("normalizeEmptyTaskItems", () => {
  it("adds a trailing space to an empty unchecked task item", () => {
    expect(normalizeEmptyTaskItems("- [ ]")).toBe("- [ ] ");
  });

  it("adds a trailing space to an empty checked task item", () => {
    expect(normalizeEmptyTaskItems("- [x]")).toBe("- [x] ");
    expect(normalizeEmptyTaskItems("- [X]")).toBe("- [X] ");
  });

  it("handles plus and star bullet markers", () => {
    expect(normalizeEmptyTaskItems("+ [ ]")).toBe("+ [ ] ");
    expect(normalizeEmptyTaskItems("* [ ]")).toBe("* [ ] ");
  });

  it("normalizes indented (nested) empty task items", () => {
    expect(normalizeEmptyTaskItems("  - [ ]")).toBe("  - [ ] ");
    expect(normalizeEmptyTaskItems("\t- [x]")).toBe("\t- [x] ");
  });

  it("leaves task items with content unchanged (bracket not line-terminal)", () => {
    const md = "- [ ] Buy milk";
    expect(normalizeEmptyTaskItems(md)).toBe(md);
  });

  it("leaves an already-normalized empty task item unchanged", () => {
    // The regex only matches when the bracket is the LAST char on the line,
    // so a trailing space means no further match — the transform is idempotent.
    const md = "- [ ] ";
    expect(normalizeEmptyTaskItems(md)).toBe(md);
    expect(normalizeEmptyTaskItems(normalizeEmptyTaskItems("- [ ]"))).toBe(
      "- [ ] ",
    );
  });

  it("normalizes multiple empty task items across lines", () => {
    const input = "- [ ]\n- [x]\n- [ ] has content";
    expect(normalizeEmptyTaskItems(input)).toBe(
      "- [ ] \n- [x] \n- [ ] has content",
    );
  });

  it("leaves non-task content untouched", () => {
    const md = "# Heading\n\nA paragraph.\n\n- a bullet";
    expect(normalizeEmptyTaskItems(md)).toBe(md);
  });
});

// ---------------------------------------------------------------------------
// stripAnnotationsFromMarkdown (pure, direct)
// ---------------------------------------------------------------------------

describe("stripAnnotationsFromMarkdown", () => {
  it("strips a single bullet annotation and records its index", () => {
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(
      "- {star} Item one",
    );
    expect(cleaned).toBe("- Item one");
    expect(annotations.size).toBe(1);
    expect(annotations.get(0)).toBe("star");
  });

  it("maps annotations to their global list-item index (skips unannotated)", () => {
    const md = "- {star} one\n- two\n- {fire} three";
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(md);
    expect(cleaned).toBe("- one\n- two\n- three");
    expect(annotations.size).toBe(2);
    expect(annotations.get(0)).toBe("star");
    expect(annotations.get(2)).toBe("fire");
    expect(annotations.has(1)).toBe(false);
  });

  it("handles ordered and task list markers", () => {
    const md = "1. {one} first\n- [ ] {todo} do it\n- [x] {done} finished";
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(md);
    expect(cleaned).toBe("1. first\n- [ ] do it\n- [x] finished");
    expect(annotations.get(0)).toBe("one");
    expect(annotations.get(1)).toBe("todo");
    expect(annotations.get(2)).toBe("done");
  });

  it("handles nested (indented) annotated items", () => {
    const md = "- {a} Outer\n  - {b} Inner";
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(md);
    expect(cleaned).toBe("- Outer\n  - Inner");
    expect(annotations.size).toBe(2);
    expect(annotations.get(0)).toBe("a");
    expect(annotations.get(1)).toBe("b");
  });

  it("returns an empty map when there are no annotations", () => {
    const md = "- one\n- two";
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(md);
    expect(cleaned).toBe(md);
    expect(annotations.size).toBe(0);
  });

  it("does not treat braces in non-list paragraph text as annotations", () => {
    const md = "A paragraph with {braces} in it.";
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(md);
    expect(cleaned).toBe(md);
    expect(annotations.size).toBe(0);
  });

  it("only strips the annotation immediately following the marker", () => {
    // A brace group later in the line is content, not an annotation.
    const md = "- {icon} keep {this} literal";
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(md);
    expect(cleaned).toBe("- keep {this} literal");
    expect(annotations.get(0)).toBe("icon");
  });

  it("handles empty input", () => {
    const { cleaned, annotations } = stripAnnotationsFromMarkdown("");
    expect(cleaned).toBe("");
    expect(annotations.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyAnnotationsToEditor + injectAnnotationsIntoMarkdown (live editor)
// ---------------------------------------------------------------------------

describe("applyAnnotationsToEditor + injectAnnotationsIntoMarkdown", () => {
  it("round-trips: strip → apply → inject restores the annotations", () => {
    const original = "- {star} one\n\n- two\n\n- {fire} three";
    // NOTE: blank lines keep each bullet in its own single-item list so the
    // document-order index lines up 1:1 with the markdown list-item index.
    const { cleaned, annotations } = stripAnnotationsFromMarkdown(original);

    const editor = createTestEditor(cleaned);
    applyAnnotationsToEditor(editor, annotations);

    // The annotation attribute should have landed on the right list items.
    const icons: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "listItem" || node.type.name === "taskItem") {
        icons.push(node.attrs.annotation);
      }
    });
    expect(icons).toEqual([
      JSON.stringify({ icon: "star" }),
      null,
      JSON.stringify({ icon: "fire" }),
    ]);

    const injected = injectAnnotationsIntoMarkdown(
      getRawMarkdown(editor),
      editor,
    );
    expect(injected).toContain("{star}");
    expect(injected).toContain("{fire}");

    // Re-stripping the injected markdown recovers the same annotation map.
    const restripped = stripAnnotationsFromMarkdown(injected);
    expect(restripped.annotations.get(0)).toBe("star");
    expect(restripped.annotations.get(2)).toBe("fire");

    editor.destroy();
  });

  it("is a no-op for an empty annotation map", () => {
    const editor = createTestEditor("- one\n- two");
    applyAnnotationsToEditor(editor, new Map());
    editor.state.doc.descendants((node) => {
      if (node.type.name === "listItem") {
        expect(node.attrs.annotation).toBeNull();
      }
    });
    editor.destroy();
  });

  it("does not throw when the editor is destroyed", () => {
    const editor = createTestEditor("- one");
    editor.destroy();
    expect(() =>
      applyAnnotationsToEditor(editor, new Map([[0, "star"]])),
    ).not.toThrow();
  });

  it("injectAnnotationsIntoMarkdown returns markdown unchanged when no node carries an annotation", () => {
    const editor = createTestEditor("- one\n- two");
    const md = "- one\n- two";
    expect(injectAnnotationsIntoMarkdown(md, editor)).toBe(md);
    editor.destroy();
  });

  it("injectAnnotationsIntoMarkdown ignores invalid JSON in the annotation attr", () => {
    const editor = createTestEditor("- one\n- two");
    // Force a corrupted annotation attribute onto the first list item.
    editor.commands.command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name === "listItem") {
          tr.setNodeAttribute(pos, "annotation", "{not valid json");
          return false;
        }
        return true;
      });
      return true;
    });
    // No valid icon anywhere ⇒ markdown returned unchanged (no throw).
    const md = "- one\n- two";
    expect(injectAnnotationsIntoMarkdown(md, editor)).toBe(md);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// stripNodeIdComments (pure, direct)
// ---------------------------------------------------------------------------

describe("stripNodeIdComments", () => {
  const UUID_A = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
  const UUID_B = "11111111-2222-3333-4444-555555555555";

  it("strips id comments and records them by 0-based block index", () => {
    const md = [
      `<!-- id:${UUID_A} -->`,
      "# Hello",
      "",
      `<!-- id:${UUID_B} -->`,
      "A paragraph.",
    ].join("\n");
    const { cleaned, nodeIds } = stripNodeIdComments(md);
    expect(cleaned).toBe("# Hello\n\nA paragraph.");
    expect(nodeIds.size).toBe(2);
    expect(nodeIds.get(0)).toBe(UUID_A);
    expect(nodeIds.get(1)).toBe(UUID_B);
  });

  it("only records the id for the block it precedes, not intervening blocks", () => {
    const md = [
      "# First",
      "",
      `<!-- id:${UUID_A} -->`,
      "Second block.",
    ].join("\n");
    const { cleaned, nodeIds } = stripNodeIdComments(md);
    expect(cleaned).toBe("# First\n\nSecond block.");
    // The id belongs to block index 1 (Second block), not index 0.
    expect(nodeIds.size).toBe(1);
    expect(nodeIds.get(1)).toBe(UUID_A);
    expect(nodeIds.has(0)).toBe(false);
  });

  it("ignores malformed UUIDs and unrelated comments", () => {
    const md = [
      "<!-- id:not-a-uuid -->",
      "# Hello",
      "",
      "<!-- toc -->",
      "text",
    ].join("\n");
    const { cleaned, nodeIds } = stripNodeIdComments(md);
    expect(cleaned).toBe(md);
    expect(nodeIds.size).toBe(0);
  });

  it("returns an empty map for markdown with no id comments", () => {
    const md = "# Hello\n\nWorld";
    const { cleaned, nodeIds } = stripNodeIdComments(md);
    expect(cleaned).toBe(md);
    expect(nodeIds.size).toBe(0);
  });

  it("handles empty input", () => {
    const { cleaned, nodeIds } = stripNodeIdComments("");
    expect(cleaned).toBe("");
    expect(nodeIds.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyNodeIdsToEditor + injectNodeIdComments (live editor round-trip)
// ---------------------------------------------------------------------------

describe("applyNodeIdsToEditor + injectNodeIdComments", () => {
  const UUID_A = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const UUID_B = "11111111-2222-3333-4444-555555555555";

  it("applies node IDs to top-level block nodes by index", () => {
    const editor = createTestEditor("# Heading one\n\nParagraph two.");
    applyNodeIdsToEditor(editor, new Map([[0, UUID_A], [1, UUID_B]]));

    const ids: unknown[] = [];
    editor.state.doc.forEach((node) => ids.push(node.attrs.id));
    expect(ids[0]).toBe(UUID_A);
    expect(ids[1]).toBe(UUID_B);
    editor.destroy();
  });

  it("is a no-op for an empty id map", () => {
    const editor = createTestEditor("# Heading\n\nParagraph.");
    applyNodeIdsToEditor(editor, new Map());
    editor.state.doc.forEach((node) => {
      // No auto-generated IDs in this test editor (generateID → ""),
      // so an empty map must leave every block id falsy.
      expect(node.attrs.id).toBeFalsy();
    });
    editor.destroy();
  });

  it("full round-trip: strip → apply → inject reproduces the id comments", () => {
    const original = [
      `<!-- id:${UUID_A} -->`,
      "# First heading",
      "",
      `<!-- id:${UUID_B} -->`,
      "Second paragraph.",
    ].join("\n");

    const { cleaned, nodeIds } = stripNodeIdComments(original);
    const editor = createTestEditor(cleaned);
    applyNodeIdsToEditor(editor, nodeIds);

    const injected = injectNodeIdComments(getRawMarkdown(editor), editor);
    const lines = injected.split("\n");

    // Each id comment must sit on the line directly above its block.
    const idLineA = lines.indexOf(`<!-- id:${UUID_A} -->`);
    const idLineB = lines.indexOf(`<!-- id:${UUID_B} -->`);
    expect(idLineA).toBeGreaterThanOrEqual(0);
    expect(idLineB).toBeGreaterThanOrEqual(0);
    expect(lines[idLineA + 1]).toContain("First heading");
    expect(lines[idLineB + 1]).toContain("Second paragraph.");
    editor.destroy();
  });

  it("injectNodeIdComments returns markdown unchanged when no block has an id", () => {
    const editor = createTestEditor("# Hello\n\nWorld.");
    const md = "# Hello\n\nWorld.";
    expect(injectNodeIdComments(md, editor)).toBe(md);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// extractTableColumnMetadata (pure)
// ---------------------------------------------------------------------------

describe("extractTableColumnMetadata", () => {
  it("leaves tables without comments untouched", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const { cleaned, metadata } = extractTableColumnMetadata(md);
    expect(cleaned).toBe(md);
    expect(metadata.size).toBe(0);
  });

  it("extracts per-column metadata and strips the comment from the header", () => {
    const md =
      "| Name | Price <!-- type:number,currency:USD,summary:sum --> |\n| --- | --- |\n| Apple | 1.50 |";
    const { cleaned, metadata } = extractTableColumnMetadata(md);
    expect(cleaned).toContain("| Name | Price |");
    expect(cleaned).not.toContain("<!--");
    const table0 = metadata.get(0);
    expect(table0).toBeDefined();
    expect(table0?.get(1)).toEqual({
      colType: "number",
      colCurrency: "USD",
      colAggregation: "sum",
    });
    expect(table0?.has(0)).toBe(false);
  });

  it("indexes multiple tables independently", () => {
    const md = [
      "| A <!-- type:number --> | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "text",
      "",
      "| C | D <!-- summary:sum --> |",
      "| --- | --- |",
      "| 3 | 4 |",
    ].join("\n");
    const { metadata } = extractTableColumnMetadata(md);
    expect(metadata.size).toBe(2);
    expect(metadata.get(0)?.get(0)).toEqual({ colType: "number" });
    expect(metadata.get(1)?.get(1)).toEqual({ colAggregation: "sum" });
  });

  it("ignores unknown metadata keys but keeps recognized ones", () => {
    const md =
      "| A <!-- type:number,bogus:x --> | B |\n| --- | --- |\n| 1 | 2 |";
    const { cleaned, metadata } = extractTableColumnMetadata(md);
    expect(metadata.get(0)?.get(0)).toEqual({ colType: "number" });
    expect(cleaned).not.toContain("<!--");
  });

  it("does not record a table when the comment carries no recognized keys", () => {
    const md = "| A <!-- foo:bar --> | B |\n| --- | --- |\n| 1 | 2 |";
    const { cleaned, metadata } = extractTableColumnMetadata(md);
    // No recognized keys ⇒ no table entry. The header line is only rewritten
    // when at least one column yields metadata, so with none the original
    // markdown (comment included) is returned verbatim.
    expect(metadata.size).toBe(0);
    expect(cleaned).toBe(md);
  });

  it("leaves non-table content unchanged", () => {
    const md = "# Title\n\nSome text\n\n| A | B |\n| --- | --- |\n| 1 | 2 |";
    expect(extractTableColumnMetadata(md).cleaned).toBe(md);
  });

  it("handles empty input", () => {
    const { cleaned, metadata } = extractTableColumnMetadata("");
    expect(cleaned).toBe("");
    expect(metadata.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// applyTableColumnMetadata (live editor)
// ---------------------------------------------------------------------------

describe("applyTableColumnMetadata", () => {
  it("is a no-op for an empty metadata map", () => {
    const editor = createTestEditor("# Just a heading");
    expect(() => applyTableColumnMetadata(editor, new Map())).not.toThrow();
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// convertTocToHtml / restoreTocComments
// ---------------------------------------------------------------------------

describe("convertTocToHtml / restoreTocComments", () => {
  it("converts a standalone toc comment to a div", () => {
    expect(convertTocToHtml("<!-- toc -->")).toBe(
      '<div data-toc="true" class="toc-block"></div>',
    );
  });

  it("only matches the toc comment on its own line", () => {
    const md = "before\n<!-- toc -->\nafter";
    expect(convertTocToHtml(md)).toBe(
      'before\n<div data-toc="true" class="toc-block"></div>\nafter',
    );
  });

  it("leaves unrelated comments untouched", () => {
    const md = "<!-- id:abc --> text and <!-- toc --> inline";
    // Not on its own line ⇒ no conversion.
    expect(convertTocToHtml(md)).toBe(md);
  });

  it("restoreTocComments reverses the toc div back to a comment", () => {
    expect(
      restoreTocComments('<div data-toc="true" class="toc-block"></div>'),
    ).toBe("<!-- toc -->");
  });

  it("round-trips: convert → restore is identity for a toc marker", () => {
    const md = "# Doc\n\n<!-- toc -->\n\ncontent";
    expect(restoreTocComments(convertTocToHtml(md))).toBe(md);
  });

  it("convertTocToHtml is idempotent on already-converted markup", () => {
    const converted = convertTocToHtml("<!-- toc -->");
    expect(convertTocToHtml(converted)).toBe(converted);
  });
});

// ---------------------------------------------------------------------------
// encodeImagePathSpaces / decodeImagePathSpaces
// ---------------------------------------------------------------------------

describe("encodeImagePathSpaces / decodeImagePathSpaces", () => {
  it("encodes spaces in a local image path", () => {
    expect(encodeImagePathSpaces("![alt](/a b/c d.png)")).toBe(
      "![alt](/a%20b/c%20d.png)",
    );
  });

  it("preserves a title segment while encoding the path", () => {
    const encoded = encodeImagePathSpaces('![alt](/a b/c.png "My Title")');
    expect(encoded).toBe('![alt](/a%20b/c.png "My Title")');
  });

  it("leaves remote URLs, data URIs, and angle-bracket dests unchanged", () => {
    const remote = "![a](https://x.com/a b.png)";
    const data = "![a](data:image/png;base64,zzz)";
    const angle = "![a](</a b/c.png>)";
    expect(encodeImagePathSpaces(remote)).toBe(remote);
    expect(encodeImagePathSpaces(data)).toBe(data);
    expect(encodeImagePathSpaces(angle)).toBe(angle);
  });

  it("leaves paths without spaces unchanged", () => {
    const md = "![a](/no/spaces.png)";
    expect(encodeImagePathSpaces(md)).toBe(md);
  });

  it("decodes %20 back to spaces in local paths", () => {
    expect(decodeImagePathSpaces("![alt](/a%20b/c%20d.png)")).toBe(
      "![alt](/a b/c d.png)",
    );
  });

  it("decode leaves remote URLs and %20-free paths unchanged", () => {
    const remote = "![a](https://x.com/a%20b.png)";
    const plain = "![a](/no-encoding.png)";
    expect(decodeImagePathSpaces(remote)).toBe(remote);
    expect(decodeImagePathSpaces(plain)).toBe(plain);
  });

  it("encode → decode is identity for a local path with spaces", () => {
    const original = "![alt](/some path/with spaces.png)";
    expect(decodeImagePathSpaces(encodeImagePathSpaces(original))).toBe(
      original,
    );
  });

  it("round-trips multiple images in one string", () => {
    const original = "![a](/one dir/a.png) x ![b](/two dir/b.png)";
    expect(decodeImagePathSpaces(encodeImagePathSpaces(original))).toBe(
      original,
    );
  });
});
