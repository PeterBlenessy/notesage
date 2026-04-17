/**
 * TEMPLATE — Tiptap node with markdown round-trip support.
 *
 * Canonical shape for any node that must parse from / serialize to markdown
 * via tiptap-markdown. Update this file when the intended pattern changes
 * (rare), not per new node added to the editor.
 *
 * Real references in production:
 *   - Atom node (HTML-comment marker): src/components/editor/extensions/page-break-node.ts
 *   - Content block (with attributes): src/components/editor/extensions/callout.ts
 */

import { Node, mergeAttributes } from "@tiptap/core";

export const MyNode = Node.create({
  name: "myNode",
  group: "block",
  atom: true, // set to false if the node has inline/block content
  draggable: true,
  selectable: true,

  addAttributes() {
    // Every attribute that affects the rendered markdown MUST round-trip:
    // parseHTML extracts it from the DOM, renderHTML writes it back.
    return {
      value: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-value"),
        renderHTML: (attrs) =>
          attrs.value ? { "data-value": attrs.value } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-my-node]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-my-node": "",
        contenteditable: "false",
      }),
    ];
  },

  addStorage() {
    return {
      markdown: {
        /**
         * Serialize the node to markdown. Serializer state helpers:
         *   state.write(text)         — emit raw text
         *   state.closeBlock(node)    — finish a block (adds trailing newline)
         *   state.ensureNewLine()     — force newline if not already at one
         *   state.renderContent(node) — recurse into children (non-atom nodes)
         */
        serialize(state: unknown, node: unknown) {
          const s = state as {
            write: (text: string) => void;
            closeBlock: (node: unknown) => void;
            ensureNewLine: () => void;
            renderContent: (node: unknown) => void;
          };
          s.ensureNewLine();
          s.write("<!-- my-node -->");
          s.closeBlock(node);
        },

        /**
         * Parsing is usually handled by parseHTML above — tiptap-markdown
         * passes HTML through. Only populate this block if you need a custom
         * markdown-it plugin (e.g., to recognize `~sub~` tokens).
         */
        parse: {},
      },
    };
  },
});
