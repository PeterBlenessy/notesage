import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { createElement, useEffect, useState, useCallback, memo, type ComponentType } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TocHeading {
  level: number;
  text: string;
  pos: number;
}

export const TocPluginKey = new PluginKey("tableOfContents");

// ---------------------------------------------------------------------------
// Heading scanner — extracts H1-H3 from ProseMirror document
// ---------------------------------------------------------------------------

export function scanHeadings(doc: ProseMirrorNode): TocHeading[] {
  const headings: TocHeading[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const level = node.attrs.level as number;
      if (level >= 1 && level <= 3) {
        headings.push({
          level,
          text: node.textContent,
          pos,
        });
      }
    }
  });
  return headings;
}

// ---------------------------------------------------------------------------
// Commands declaration
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

// ---------------------------------------------------------------------------
// React view component
// ---------------------------------------------------------------------------

interface TocViewProps {
  editor: {
    state: { doc: ProseMirrorNode };
    view: {
      dispatch: (tr: unknown) => void;
      dom: HTMLElement;
    };
    on: (event: string, callback: () => void) => void;
    off: (event: string, callback: () => void) => void;
  };
}

const TocView = memo(function TocView({ editor }: TocViewProps) {
  const [headings, setHeadings] = useState<TocHeading[]>([]);

  const updateHeadings = useCallback(() => {
    const result = scanHeadings(editor.state.doc);
    setHeadings(result);
  }, [editor]);

  useEffect(() => {
    // Scan on mount
    updateHeadings();

    // Re-scan on every document update
    editor.on("update", updateHeadings);
    return () => {
      editor.off("update", updateHeadings);
    };
  }, [editor, updateHeadings]);

  const handleClick = useCallback(
    (pos: number) => {
      // Scroll to the heading position in the editor
      const resolvedPos = editor.state.doc.resolve(pos);
      // Find the DOM node for this position
      const headingNode = resolvedPos.nodeAfter;
      if (!headingNode) return;

      // Walk the DOM to find the actual heading element
      const domAtPos = (editor.view as unknown as { domAtPos: (pos: number) => { node: Node; offset: number } }).domAtPos(pos);
      if (domAtPos?.node) {
        const el =
          domAtPos.node instanceof HTMLElement
            ? domAtPos.node
            : (domAtPos.node as unknown as HTMLElement).parentElement;
        if (el) {
          // Find the actual heading element (might be a child)
          const headingEl =
            el.tagName?.match(/^H[1-6]$/i) ? el : el.querySelector("h1, h2, h3");
          const target = headingEl || el;
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    },
    [editor]
  );

  // Determine the minimum heading level to normalize indentation
  const minLevel = headings.length > 0
    ? Math.min(...headings.map((h) => h.level))
    : 1;

  return createElement(
    NodeViewWrapper,
    { className: "toc-block", contentEditable: false },
    createElement(
      "div",
      { className: "toc-header" },
      "Table of Contents"
    ),
    headings.length === 0
      ? createElement(
          "div",
          { className: "toc-empty" },
          "No headings found. Add headings (H1\u2013H3) to populate this table of contents."
        )
      : createElement(
          "ul",
          { className: "toc-list" },
          headings.map((heading, index) =>
            createElement(
              "li",
              {
                key: `${heading.pos}-${index}`,
                className: `toc-item toc-level-${heading.level - minLevel}`,
              },
              createElement(
                "button",
                {
                  type: "button",
                  className: "toc-link",
                  onClick: () => handleClick(heading.pos),
                },
                heading.text || "(empty heading)"
              )
            )
          )
        )
  );
});

// ---------------------------------------------------------------------------
// Node extension
// ---------------------------------------------------------------------------

export const TableOfContents = Node.create({
  name: "tableOfContents",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-toc]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-toc": "",
        class: "toc-block",
        contenteditable: "false",
      }),
      ["span", {}, "Table of Contents"],
    ];
  },

  addNodeView() {
    // TocView narrows the node-view props `editor` to the members it uses;
    // widen back through `unknown` to the renderer's expected component type.
    return ReactNodeViewRenderer(TocView as unknown as ComponentType<ReactNodeViewProps>, {
      update: ({ oldNode, newNode, updateProps }) => {
        if (oldNode.sameMarkup(newNode)) return true;
        updateProps();
        return true;
      },
    });
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) => {
          return commands.insertContent({ type: this.name });
        },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: unknown, node: unknown) {
          const s = state as {
            write: (text: string) => void;
            closeBlock: (node: unknown) => void;
            ensureNewLine: () => void;
          };
          s.ensureNewLine();
          s.write("<!-- toc -->");
          s.closeBlock(node);
        },
        parse: {
          // Handled by convertTocToHtml preprocessor in markdown.ts
        },
      },
    };
  },
});
