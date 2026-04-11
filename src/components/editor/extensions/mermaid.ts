import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { MermaidPreview } from "../MermaidPreview";

const DEFAULT_MERMAID_SOURCE = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Result]
    B -->|No| D[Other]`;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mermaidBlock: {
      insertMermaidBlock: (attrs?: { source?: string }) => ReturnType;
    };
  }
}

export const MermaidBlock = Node.create({
  name: "mermaidBlock",
  group: "block",
  atom: true,

  addAttributes() {
    return {
      source: {
        default: "",
        parseHTML: (element: HTMLElement) =>
          element.getAttribute("data-mermaid-source") || "",
        renderHTML: (attributes: Record<string, unknown>) => ({
          "data-mermaid-source": attributes.source as string,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-mermaid-source]",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: "mermaid-block",
        "data-type": "mermaid",
      }),
      ["div", { class: "mermaid-placeholder" }, "Mermaid Diagram"],
    ];
  },

  addCommands() {
    return {
      insertMermaidBlock:
        (attrs?: { source?: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              source: attrs?.source || DEFAULT_MERMAID_SOURCE,
            },
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidPreview);
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: unknown, node: unknown) {
          const s = state as {
            write: (text: string) => void;
          };
          const n = node as {
            attrs: { source: string };
          };

          const source = n.attrs.source;
          if (!source) return;

          s.write("```mermaid\n" + source + "\n```\n\n");
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
        },
      },
    };
  },
});
