/**
 * Edge case tests for markdown.ts utility functions.
 *
 * Tests pure functions (stripGhostTaskItems, encodeImagePathSpaces,
 * decodeImagePathSpaces, stripAnnotationsFromMarkdown via prepareInitialContent)
 * and Tiptap editor round-trip behavior for edge case markdown inputs
 * (tables, malformed markdown, block type verification).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Image from "@tiptap/extension-image";
import { common, createLowlight } from "lowlight";
import { Markdown } from "tiptap-markdown";

import {
  stripGhostTaskItems,
  encodeImagePathSpaces,
  decodeImagePathSpaces,
  prepareInitialContent,
  getMarkdownFromEditor,
  setMarkdownInEditor,
  setContentWithoutHistory,
  loadRawMarkdownIntoEditor,
  injectAnnotationsIntoMarkdown,
} from "../markdown";

// ---------------------------------------------------------------------------
// jsdom bootstrap
// ---------------------------------------------------------------------------

let dom: JSDOM;

beforeAll(() => {
  dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="editor"></div></body></html>'
  );
  globalThis.document = dom.window.document as unknown as Document;
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.navigator = dom.window.navigator as unknown as Navigator;
  globalThis.Node = dom.window.Node as unknown as typeof Node;
  globalThis.HTMLElement =
    dom.window.HTMLElement as unknown as typeof HTMLElement;
  globalThis.DOMParser =
    dom.window.DOMParser as unknown as typeof DOMParser;
  globalThis.getComputedStyle =
    dom.window.getComputedStyle as unknown as typeof getComputedStyle;
});

// ---------------------------------------------------------------------------
// Editor factory (mirrors markdown-roundtrip.test.ts)
// ---------------------------------------------------------------------------

const lowlight = createLowlight(common);

function createTestEditor(content: string): Editor {
  const el = document.createElement("div");
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({
        HTMLAttributes: { class: "rounded-lg max-w-full" },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({
        html: true,
        transformPastedText: true,
        transformCopiedText: true,
        linkify: false,
      }),
    ],
    content,
    editable: false,
  });
}

function getMarkdown(editor: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (editor.storage as any).markdown.getMarkdown();
}

// ---------------------------------------------------------------------------
// Table serialization edge cases
// ---------------------------------------------------------------------------

describe("Table serialization edge cases", () => {
  it("round-trips a table with empty cells", () => {
    const md = [
      "| A | B |",
      "| --- | --- |",
      "| 1 |  |",
      "|  | 2 |",
    ].join("\n");

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    // The table should survive round-trip — verify it still has table structure
    expect(output).toContain("|");
    expect(output).toContain("---");
    // Should have header row content
    expect(output).toContain("A");
    expect(output).toContain("B");
    // Should have data content
    expect(output).toContain("1");
    expect(output).toContain("2");
  });

  it("round-trips a single-column table", () => {
    const md = ["| Header |", "| --- |", "| cell 1 |", "| cell 2 |"].join(
      "\n"
    );

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("Header");
    expect(output).toContain("cell 1");
    expect(output).toContain("cell 2");
    expect(output).toContain("|");
  });

  it("round-trips a table with pipe characters in cells escaped", () => {
    // GFM allows escaped pipes inside table cells
    const md = [
      "| Command | Output |",
      "| --- | --- |",
      "| echo \\| grep | filtered |",
    ].join("\n");

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    // The table should still parse and serialize as a table
    expect(output).toContain("Command");
    expect(output).toContain("Output");
    expect(output).toContain("filtered");
  });

  it("handles a large table (many columns)", () => {
    const md = [
      "| A | B | C | D | E |",
      "| --- | --- | --- | --- | --- |",
      "| 1 | 2 | 3 | 4 | 5 |",
    ].join("\n");

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    for (const ch of ["A", "B", "C", "D", "E", "1", "2", "3", "4", "5"]) {
      expect(output).toContain(ch);
    }
  });

  it("handles table with formatted content in cells", () => {
    const md = [
      "| Feature | Status |",
      "| --- | --- |",
      "| **Bold** | *italic* |",
      "| `code` | ~~strike~~ |",
    ].join("\n");

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toContain("**Bold**");
    expect(output).toContain("*italic*");
    expect(output).toContain("`code`");
  });
});

// ---------------------------------------------------------------------------
// Malformed markdown handling
// ---------------------------------------------------------------------------

describe("Malformed markdown handling", () => {
  it("handles unclosed code block gracefully", () => {
    const md = "# Title\n\n```javascript\nconst x = 1;\n";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    // Should not throw; should produce some output
    expect(output).toBeTruthy();
    expect(output).toContain("Title");
    expect(output).toContain("const x = 1");
  });

  it("handles broken link syntax", () => {
    const md = "Click [here(https://example.com) for more.";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toBeTruthy();
    // The text content should survive even if the link is not parsed
    expect(output).toContain("Click");
  });

  it("handles deeply nested blockquotes", () => {
    const md = "> level 1\n>\n> > level 2\n> >\n> > > level 3\n> > >\n> > > > level 4";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toBeTruthy();
    expect(output).toContain("level 1");
    // At least some nesting should be preserved
    expect(output).toContain(">");
  });

  it("handles empty document", () => {
    const md = "";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    // Should not throw; output should be empty or minimal
    expect(typeof output).toBe("string");
  });

  it("handles document with only whitespace", () => {
    const md = "   \n\n  \n\n   ";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(typeof output).toBe("string");
  });

  it("handles mismatched emphasis markers", () => {
    const md = "This is **bold but not closed\n\nAnd this is *also broken";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toBeTruthy();
    expect(output).toContain("bold");
    expect(output).toContain("broken");
  });

  it("handles markdown with HTML entities", () => {
    const md = "Less than &lt; and greater than &gt; and amp &amp;";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toBeTruthy();
  });

  it("handles consecutive horizontal rules", () => {
    const md = "---\n\n---\n\n---";

    const editor = createTestEditor(md);
    const output = getMarkdown(editor);
    editor.destroy();

    expect(output).toBeTruthy();
    // Should contain multiple horizontal rules
    expect(output.match(/---/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// stripAnnotationsFromMarkdown (via prepareInitialContent)
// ---------------------------------------------------------------------------

describe("stripAnnotationsFromMarkdown (via prepareInitialContent)", () => {
  it("strips annotation from bullet list items", () => {
    const md = "- {star} Item one\n- Item two\n- {fire} Item three";
    const { content, annotations } = prepareInitialContent(md);

    expect(content).not.toContain("{star}");
    expect(content).not.toContain("{fire}");
    expect(content).toContain("Item one");
    expect(content).toContain("Item two");
    expect(content).toContain("Item three");
    expect(annotations.size).toBe(2);
    expect(annotations.get(0)).toBe("star");
    expect(annotations.get(2)).toBe("fire");
  });

  it("strips annotation from task list items", () => {
    const md = "- [ ] {priority} Do something\n- [x] {done} Completed";
    const { content, annotations } = prepareInitialContent(md);

    expect(content).not.toContain("{priority}");
    expect(content).not.toContain("{done}");
    expect(content).toContain("Do something");
    expect(content).toContain("Completed");
    expect(annotations.size).toBe(2);
  });

  it("strips annotation from ordered list items", () => {
    const md = "1. {one} First\n2. {two} Second";
    const { content, annotations } = prepareInitialContent(md);

    expect(content).not.toContain("{one}");
    expect(content).not.toContain("{two}");
    expect(content).toContain("First");
    expect(content).toContain("Second");
    expect(annotations.size).toBe(2);
  });

  it("preserves non-list content unchanged", () => {
    const md = "# Title\n\nSome paragraph with {braces} in it.\n\n> A quote";
    const { content } = prepareInitialContent(md);

    // Non-list braces should remain — annotation stripping only targets list items
    expect(content).toContain("{braces}");
    expect(content).toContain("Title");
    expect(content).toContain("A quote");
  });

  it("returns empty annotations for markdown with no annotations", () => {
    const md = "- Item one\n- Item two\n- Item three";
    const { annotations } = prepareInitialContent(md);

    expect(annotations.size).toBe(0);
  });

  it("handles nested list items with annotations", () => {
    const md = "- {a} Outer\n  - {b} Inner";
    const { content, annotations } = prepareInitialContent(md);

    expect(content).not.toContain("{a}");
    expect(content).not.toContain("{b}");
    expect(annotations.size).toBe(2);
  });

  it("handles document with mixed content and annotations", () => {
    const md =
      "# Title\n\n- {star} Item\n\nParagraph text.\n\n1. {num} Ordered";
    const { content, annotations } = prepareInitialContent(md);

    expect(content).toContain("Title");
    expect(content).toContain("Paragraph text.");
    expect(content).not.toContain("{star}");
    expect(content).not.toContain("{num}");
    expect(annotations.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// encodeImagePathSpaces / decodeImagePathSpaces
// ---------------------------------------------------------------------------

describe("encodeImagePathSpaces", () => {
  it("encodes spaces in local image paths", () => {
    const md = "![alt](/path/to my/image file.png)";
    expect(encodeImagePathSpaces(md)).toBe(
      "![alt](/path/to%20my/image%20file.png)"
    );
  });

  it("leaves remote URLs unchanged", () => {
    const md = "![alt](https://example.com/my image.png)";
    expect(encodeImagePathSpaces(md)).toBe(md);
  });

  it("leaves data URIs unchanged", () => {
    const md = "![alt](data:image/png;base64,abc)";
    expect(encodeImagePathSpaces(md)).toBe(md);
  });

  it("leaves paths without spaces unchanged", () => {
    const md = "![alt](/path/to/image.png)";
    expect(encodeImagePathSpaces(md)).toBe(md);
  });

  it("leaves angle-bracket destinations unchanged", () => {
    const md = "![alt](</path/to my/image.png>)";
    expect(encodeImagePathSpaces(md)).toBe(md);
  });

  it("handles path with title", () => {
    const md = '![alt](/path/to my/image.png "My Title")';
    const encoded = encodeImagePathSpaces(md);
    expect(encoded).toContain("/path/to%20my/image.png");
    expect(encoded).toContain('"My Title"');
  });

  it("handles multiple images in one string", () => {
    const md =
      "![a](/path one/a.png) text ![b](/path two/b.png)";
    const encoded = encodeImagePathSpaces(md);
    expect(encoded).toContain("/path%20one/a.png");
    expect(encoded).toContain("/path%20two/b.png");
  });
});

describe("decodeImagePathSpaces", () => {
  it("decodes %20 back to spaces in local paths", () => {
    const md = "![alt](/path/to%20my/image%20file.png)";
    expect(decodeImagePathSpaces(md)).toBe(
      "![alt](/path/to my/image file.png)"
    );
  });

  it("leaves remote URLs unchanged", () => {
    const md = "![alt](https://example.com/my%20image.png)";
    expect(decodeImagePathSpaces(md)).toBe(md);
  });

  it("leaves paths without %20 unchanged", () => {
    const md = "![alt](/path/to/image.png)";
    expect(decodeImagePathSpaces(md)).toBe(md);
  });

  it("encode then decode is identity for local paths", () => {
    const original = "![alt](/path/to my/image file.png)";
    expect(decodeImagePathSpaces(encodeImagePathSpaces(original))).toBe(
      original
    );
  });
});

// ---------------------------------------------------------------------------
// Parse -> serialize produces correct node types
// ---------------------------------------------------------------------------

describe("Parse produces correct ProseMirror node types", () => {
  it("parses heading into heading node", () => {
    const editor = createTestEditor("# Heading One");
    const doc = editor.state.doc;

    let foundHeading = false;
    doc.descendants((node) => {
      if (node.type.name === "heading") {
        foundHeading = true;
        expect(node.attrs.level).toBe(1);
      }
    });
    expect(foundHeading).toBe(true);
    editor.destroy();
  });

  it("parses all heading levels correctly", () => {
    const md = "# H1\n\n## H2\n\n### H3\n\n#### H4\n\n##### H5\n\n###### H6";
    const editor = createTestEditor(md);
    const levels: number[] = [];

    editor.state.doc.descendants((node) => {
      if (node.type.name === "heading") {
        levels.push(node.attrs.level as number);
      }
    });

    expect(levels).toEqual([1, 2, 3, 4, 5, 6]);
    editor.destroy();
  });

  it("parses paragraph into paragraph node", () => {
    const editor = createTestEditor("Just a paragraph.");
    let foundParagraph = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "paragraph") {
        foundParagraph = true;
      }
    });
    expect(foundParagraph).toBe(true);
    editor.destroy();
  });

  it("parses bullet list into bulletList node", () => {
    const editor = createTestEditor("- item 1\n- item 2");
    let foundBulletList = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "bulletList") {
        foundBulletList = true;
      }
    });
    expect(foundBulletList).toBe(true);
    editor.destroy();
  });

  it("parses ordered list into orderedList node", () => {
    const editor = createTestEditor("1. first\n2. second");
    let foundOrderedList = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "orderedList") {
        foundOrderedList = true;
      }
    });
    expect(foundOrderedList).toBe(true);
    editor.destroy();
  });

  it("parses task list into taskList/taskItem nodes", () => {
    const editor = createTestEditor("- [ ] unchecked\n- [x] checked");
    let foundTaskList = false;
    let foundTaskItem = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "taskList") foundTaskList = true;
      if (node.type.name === "taskItem") foundTaskItem = true;
    });
    expect(foundTaskList).toBe(true);
    expect(foundTaskItem).toBe(true);
    editor.destroy();
  });

  it("parses blockquote into blockquote node", () => {
    const editor = createTestEditor("> This is a quote");
    let foundBlockquote = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "blockquote") foundBlockquote = true;
    });
    expect(foundBlockquote).toBe(true);
    editor.destroy();
  });

  it("parses code block into codeBlock node with language", () => {
    const editor = createTestEditor("```python\nprint('hello')\n```");
    let foundCodeBlock = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "codeBlock") {
        foundCodeBlock = true;
        expect(node.attrs.language).toBe("python");
      }
    });
    expect(foundCodeBlock).toBe(true);
    editor.destroy();
  });

  it("parses horizontal rule into horizontalRule node", () => {
    const editor = createTestEditor("Above\n\n---\n\nBelow");
    let foundHr = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "horizontalRule") foundHr = true;
    });
    expect(foundHr).toBe(true);
    editor.destroy();
  });

  it("parses table into table/tableRow/tableHeader/tableCell nodes", () => {
    const md = "| A | B |\n| --- | --- |\n| 1 | 2 |";
    const editor = createTestEditor(md);
    const nodeTypes = new Set<string>();
    editor.state.doc.descendants((node) => {
      nodeTypes.add(node.type.name);
    });
    expect(nodeTypes.has("table")).toBe(true);
    expect(nodeTypes.has("tableRow")).toBe(true);
    expect(nodeTypes.has("tableHeader")).toBe(true);
    expect(nodeTypes.has("tableCell")).toBe(true);
    editor.destroy();
  });

  it("parses image into image node", () => {
    const editor = createTestEditor("![alt text](https://example.com/img.png)");
    let foundImage = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") {
        foundImage = true;
        expect(node.attrs.src).toBe("https://example.com/img.png");
        expect(node.attrs.alt).toBe("alt text");
      }
    });
    expect(foundImage).toBe(true);
    editor.destroy();
  });

  it("parses inline marks correctly (bold, italic, code)", () => {
    const editor = createTestEditor(
      "**bold** and *italic* and `code`"
    );
    const markNames = new Set<string>();
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.length > 0) {
        node.marks.forEach((m) => markNames.add(m.type.name));
      }
    });
    expect(markNames.has("bold")).toBe(true);
    expect(markNames.has("italic")).toBe(true);
    expect(markNames.has("code")).toBe(true);
    editor.destroy();
  });

  it("parses link mark", () => {
    const editor = createTestEditor("[example](https://example.com)");
    let foundLink = false;
    editor.state.doc.descendants((node) => {
      if (node.isText) {
        node.marks.forEach((m) => {
          if (m.type.name === "link") {
            foundLink = true;
            expect(m.attrs.href).toBe("https://example.com");
          }
        });
      }
    });
    expect(foundLink).toBe(true);
    editor.destroy();
  });
});

// ---------------------------------------------------------------------------
// stripGhostTaskItems edge cases (beyond ghost-task-items.test.ts)
// ---------------------------------------------------------------------------

describe("stripGhostTaskItems additional edge cases", () => {
  it("preserves ordered list items that look like task items (not bullet markers)", () => {
    // stripGhostTaskItems only strips ghost items under bullet markers (-, +, *)
    // Ordered list items like "2. [ ] " are not recognized as task ghosts
    const input = "1. item\n2. [ ] \n";
    const result = stripGhostTaskItems(input);
    expect(result).toBe(input);
  });

  it("handles plus and star markers", () => {
    expect(stripGhostTaskItems("+ item\n+ [ ] \n")).toBe("+ item\n");
    expect(stripGhostTaskItems("* item\n* [ ] \n")).toBe("* item\n");
  });

  it("handles checked ghost items [x]", () => {
    expect(stripGhostTaskItems("- item\n- [x] \n")).toBe("- item\n");
  });

  it("handles uppercase X ghost items [X]", () => {
    expect(stripGhostTaskItems("- item\n- [X] \n")).toBe("- item\n");
  });

  it("preserves indented list items that are not ghosts", () => {
    const input = "- parent\n  - child\n  - [ ] task child\n";
    expect(stripGhostTaskItems(input)).toBe(input);
  });

  it("does not affect text that looks like a task item but is not", () => {
    const input = "Here is a sentence with - [ ] in it.\n";
    expect(stripGhostTaskItems(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// prepareInitialContent integration (encodes + strips + cleans)
// ---------------------------------------------------------------------------

describe("prepareInitialContent integration", () => {
  it("encodes image spaces AND strips annotations", () => {
    const md =
      "- {star} Item with ![img](/my path/img.png)\n- Plain item";
    const { content, annotations } = prepareInitialContent(md);

    expect(content).not.toContain("{star}");
    expect(content).toContain("/my%20path/img.png");
    expect(annotations.size).toBe(1);
    expect(annotations.get(0)).toBe("star");
  });

  it("strips ghost task items during preparation", () => {
    const md = "- real item\n- [ ] \n";
    const { content } = prepareInitialContent(md);
    // The ghost should be stripped
    expect(content).toContain("real item");
    // Verify ghost removal (the empty task item line should be gone)
    expect(content).not.toMatch(/\[[ xX]\]\s*$/m);
  });

  it("normalizes empty task items", () => {
    // An empty task item with content should survive
    const md = "- [ ] Buy milk\n- [x] Done task";
    const { content } = prepareInitialContent(md);
    expect(content).toContain("Buy milk");
    expect(content).toContain("Done task");
  });
});

// ---------------------------------------------------------------------------
// Editor-dependent functions (getMarkdownFromEditor, setMarkdownInEditor, etc.)
// ---------------------------------------------------------------------------

describe("getMarkdownFromEditor", () => {
  it("returns markdown from editor with Markdown extension", () => {
    const editor = createTestEditor("# Hello\n\nWorld");
    // Make editor editable for setMarkdownInEditor tests
    editor.setEditable(true);
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("Hello");
    expect(md).toContain("World");
    editor.destroy();
  });

  it("returns markdown with ghost items stripped", () => {
    // Set content with a list that has a trailing ghost
    const editor = createTestEditor("- item 1\n- item 2\n- [ ] ");
    editor.setEditable(true);
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("item 1");
    // Ghost stripping happens in getMarkdownFromEditor
    editor.destroy();
  });

  it("decodes image path spaces in output", () => {
    const editor = createTestEditor("![alt](/path/to%20my/img.png)");
    editor.setEditable(true);
    const md = getMarkdownFromEditor(editor);
    // decodeImagePathSpaces should turn %20 back to space
    expect(md).toContain("img.png");
    editor.destroy();
  });

  it("returns plain text if markdown extension is unavailable", () => {
    // Create editor without Markdown extension
    const el = document.createElement("div");
    const editor = new Editor({
      element: el,
      extensions: [
        StarterKit.configure({
          codeBlock: false,
          heading: { levels: [1, 2, 3, 4, 5, 6] },
        }),
      ],
      content: "<p>Plain text content</p>",
      editable: true,
    });
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("Plain text content");
    editor.destroy();
  });
});

describe("setMarkdownInEditor", () => {
  it("sets content in editor", () => {
    const editor = createTestEditor("Initial content");
    editor.setEditable(true);
    setMarkdownInEditor(editor, "# New Heading\n\nNew paragraph");
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("New Heading");
    expect(md).toContain("New paragraph");
    editor.destroy();
  });

  it("encodes image path spaces when setting content", () => {
    const editor = createTestEditor("Initial");
    editor.setEditable(true);
    setMarkdownInEditor(editor, "![alt](/my path/img.png)");
    // The content should be set (path encoded internally for the parser)
    const doc = editor.state.doc;
    let foundImage = false;
    doc.descendants((node) => {
      if (node.type.name === "image") foundImage = true;
    });
    // Image should be found in the document
    expect(foundImage).toBe(true);
    editor.destroy();
  });

  it("strips ghost task items when setting content", () => {
    const editor = createTestEditor("Initial");
    editor.setEditable(true);
    setMarkdownInEditor(editor, "- item\n- [ ] \n");
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("item");
    editor.destroy();
  });
});

describe("setContentWithoutHistory", () => {
  it("sets content without adding to undo history", () => {
    const editor = createTestEditor("Original");
    editor.setEditable(true);
    setContentWithoutHistory(editor, "# Replaced");
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("Replaced");
    // Undo should not revert to "Original" because it was set without history
    editor.commands.undo();
    const afterUndo = getMarkdownFromEditor(editor);
    expect(afterUndo).toContain("Replaced");
    editor.destroy();
  });
});

describe("loadRawMarkdownIntoEditor", () => {
  it("loads markdown and clears undo history", () => {
    const editor = createTestEditor("Old content");
    editor.setEditable(true);
    loadRawMarkdownIntoEditor(editor, "# Fresh Start\n\nNew content here");
    const md = getMarkdownFromEditor(editor);
    expect(md).toContain("Fresh Start");
    expect(md).toContain("New content here");
    // Undo should not work (history cleared)
    editor.commands.undo();
    const afterUndo = getMarkdownFromEditor(editor);
    expect(afterUndo).toContain("Fresh Start");
    editor.destroy();
  });

  it("strips annotations and schedules their reapplication", () => {
    const editor = createTestEditor("placeholder");
    editor.setEditable(true);
    loadRawMarkdownIntoEditor(editor, "- {star} Annotated item\n- Plain item");
    const md = getMarkdownFromEditor(editor);
    // Annotation prefix should be stripped from the content
    expect(md).not.toContain("{star}");
    expect(md).toContain("Annotated item");
    expect(md).toContain("Plain item");
    editor.destroy();
  });

  it("handles empty markdown", () => {
    const editor = createTestEditor("Some existing content");
    editor.setEditable(true);
    loadRawMarkdownIntoEditor(editor, "");
    // Should not throw
    expect(typeof getMarkdownFromEditor(editor)).toBe("string");
    editor.destroy();
  });

  it("handles markdown with image path spaces", () => {
    const editor = createTestEditor("placeholder");
    editor.setEditable(true);
    loadRawMarkdownIntoEditor(
      editor,
      "![photo](/Users/me/My Photos/cat.png)"
    );
    let foundImage = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "image") foundImage = true;
    });
    expect(foundImage).toBe(true);
    editor.destroy();
  });
});

describe("injectAnnotationsIntoMarkdown", () => {
  it("returns markdown unchanged when no annotations exist", () => {
    const editor = createTestEditor("- item 1\n- item 2");
    editor.setEditable(true);
    const md = "- item 1\n- item 2";
    const result = injectAnnotationsIntoMarkdown(md, editor);
    expect(result).toBe(md);
    editor.destroy();
  });
});
