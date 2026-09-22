import { Node, mergeAttributes, InputRule } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

export type CalloutType = "note" | "tip" | "warning" | "important";

const CALLOUT_TYPES: CalloutType[] = ["note", "tip", "warning", "important"];

const CALLOUT_LABELS: Record<CalloutType, string> = {
  note: "Note",
  tip: "Tip",
  warning: "Warning",
  important: "Important",
};

// SVG icon markup for each callout type (Lucide icons inlined)
const CALLOUT_ICONS: Record<CalloutType, string> = {
  note: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  tip: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>',
  warning: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  important: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>',
};

function isValidCalloutType(type: string): type is CalloutType {
  return CALLOUT_TYPES.includes(type as CalloutType);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs?: { type?: CalloutType; title?: string | null }) => ReturnType;
      toggleCallout: (attrs?: { type?: CalloutType; title?: string | null }) => ReturnType;
      updateCalloutType: (type: CalloutType) => ReturnType;
    };
  }
}

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      type: {
        default: "note" as CalloutType,
        parseHTML: (element) => {
          for (const t of CALLOUT_TYPES) {
            if (element.classList.contains(`callout-${t}`)) return t;
          }
          return element.getAttribute("data-callout-type") || "note";
        },
        renderHTML: (attributes) => ({
          "data-callout-type": attributes.type as string,
        }),
      },
      title: {
        default: null as string | null,
        parseHTML: (element) => element.getAttribute("data-title") || null,
        renderHTML: (attributes) => {
          if (!attributes.title) return {};
          return { "data-title": attributes.title as string };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div.callout",
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const type = (node.attrs.type as CalloutType) || "note";
    const title = (node.attrs.title as string | null) || CALLOUT_LABELS[type] || "Note";

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        class: `callout callout-${type}`,
      }),
      [
        "div",
        { class: "callout-header", contenteditable: "false" },
        ["span", { class: `callout-icon callout-icon-${type}` }],
        ["span", { class: "callout-label" }, title],
      ],
      ["div", { class: "callout-content" }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attrs);
        },
      toggleCallout:
        (attrs) =>
        ({ commands, editor }) => {
          if (editor.isActive(this.name)) {
            return commands.lift(this.name);
          }
          return commands.wrapIn(this.name, attrs);
        },
      updateCalloutType:
        (type) =>
        ({ commands }) => {
          return commands.updateAttributes(this.name, { type });
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { $anchor } = editor.state.selection;
        // Only handle if at start of first child of a callout
        if ($anchor.parent.type.name !== "paragraph") return false;
        if ($anchor.parentOffset !== 0) return false;

        // Check if we're inside a callout
        const depth = $anchor.depth;
        for (let d = depth; d > 0; d--) {
          if ($anchor.node(d).type.name === this.name) {
            // If the callout has only one empty paragraph, lift it out
            const calloutNode = $anchor.node(d);
            if (
              calloutNode.childCount === 1 &&
              calloutNode.firstChild?.type.name === "paragraph" &&
              calloutNode.firstChild.content.size === 0
            ) {
              return editor.commands.lift(this.name);
            }
            // If cursor is at the very start of the callout content, lift
            const calloutContentStart = $anchor.start(d) + 1; // +1 for the callout node itself
            // Check if cursor is at the first position of the first block
            if ($anchor.pos === calloutContentStart + 1) {
              return editor.commands.lift(this.name);
            }
            return false;
          }
        }
        return false;
      },
    };
  },

  addInputRules() {
    const calloutNodeType = this.type;

    // When the user types [!type] or [!type] Title inside a blockquote,
    // convert the blockquote to a callout. Triggers on the closing ].
    const calloutInputRule = new InputRule({
      find: /^\[!(\w+)\](\s+(.+))?\s?$/,
      handler: ({ state, range, match }) => {
        const type = match[1].toLowerCase();
        if (!CALLOUT_TYPES.includes(type as CalloutType)) return;

        // Check that we're inside a blockquote
        const $from = state.doc.resolve(range.from);
        let blockquoteDepth = -1;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === "blockquote") {
            blockquoteDepth = d;
            break;
          }
        }
        if (blockquoteDepth < 0) return;

        const title = match[3]?.trim() || null;

        const blockquoteNode = $from.node(blockquoteDepth);
        const blockquoteStart = $from.before(blockquoteDepth);

        // Build callout content: same children but remove the [!type] text
        const contentNodes: (typeof state.doc)[] = [];
        blockquoteNode.forEach((child, _offset, index) => {
          if (index === 0 && child.type.name === "paragraph") {
            // First paragraph — create empty (the [!type] text gets removed)
            contentNodes.push(child.type.create(child.attrs));
          } else {
            contentNodes.push(child);
          }
        });

        const calloutNode = calloutNodeType.create(
          { type, title },
          contentNodes
        );

        const { tr } = state;
        tr.replaceWith(
          blockquoteStart,
          blockquoteStart + blockquoteNode.nodeSize,
          calloutNode
        );

        // Place cursor inside the empty first paragraph of the callout
        const cursorPos = blockquoteStart + 2;
        const $cursor = tr.doc.resolve(cursorPos);
        tr.setSelection(TextSelection.create(tr.doc, $cursor.pos));
      },
    });

    return [calloutInputRule];
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: unknown, node: unknown) {
          // tiptap-markdown calls this with (state, node, parent, index)
          // state has write(), renderContent(), etc.
          const s = state as {
            write: (text: string) => void;
            renderContent: (node: unknown) => void;
            flushClose: (size?: number) => void;
            out: string;
            closed: unknown;
          };
          const n = node as {
            attrs: { type: string; title: string | null };
            content: { forEach: (fn: (child: unknown, offset: number, index: number) => void) => void };
          };

          const type = n.attrs.type || "note";
          const title = n.attrs.title;

          // Render content to string first, then prefix each line with >
          const savedOut = s.out;
          const savedClosed = s.closed;
          s.out = "";
          s.closed = false as unknown;
          s.renderContent(n);
          const content = s.out;
          s.out = savedOut;
          s.closed = savedClosed;

          // Build the callout header
          const header = title ? `> [!${type}] ${title}` : `> [!${type}]`;

          // Prefix each content line with >
          const lines = content.split("\n");
          // Remove leading/trailing empty lines from content
          while (lines.length > 0 && lines[0].trim() === "") lines.shift();
          while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

          const prefixed = lines.map((line) => (line.trim() === "" ? ">" : `> ${line}`));

          s.write(header + "\n" + prefixed.join("\n") + "\n\n");
        },
        parse: {
          // Parsing is handled by the preprocessor in markdown.ts
        },
      },
    };
  },
});

export { CALLOUT_TYPES, CALLOUT_LABELS, CALLOUT_ICONS, isValidCalloutType };
