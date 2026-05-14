import { Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

/** Node types that support `align` and `blockWidth` attributes. */
const EMBEDDED_BLOCK_TYPES = new Set([
  "image",
  "chart",
  "drawing",
  "linkPreview",
]);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedBlockAlign: {
      /**
       * Set the `align` attribute on the embedded block node that is currently
       * selected (NodeSelection) or adjacent to the cursor (TextSelection).
       *
       * Returns `false` when no embedded block is in scope so keyboard shortcuts
       * fall through to TextAlign for ordinary heading/paragraph text.
       */
      setEmbeddedBlockAlign: (align: string) => ReturnType;
    };
  }
}

export const EmbeddedBlockAlign = Extension.create({
  name: "embeddedBlockAlign",

  addCommands() {
    return {
      setEmbeddedBlockAlign:
        (align: string) =>
        ({ state, dispatch }) => {
          const { selection } = state;

          // --- NodeSelection: user clicked the block directly ---
          if (selection instanceof NodeSelection) {
            const { node, from } = selection;
            if (!EMBEDDED_BLOCK_TYPES.has(node.type.name)) return false;

            if (dispatch) {
              const patch: Record<string, unknown> = { align };
              if (node.attrs.blockWidth == null) patch.blockWidth = 75;
              const tr = state.tr.setNodeMarkup(from, undefined, {
                ...node.attrs,
                ...patch,
              });
              dispatch(tr);
            }
            return true;
          }

          // --- TextSelection: check if cursor is adjacent to an embedded block ---
          const { $from } = selection;

          // Node immediately after the cursor
          const nodeAfter = $from.nodeAfter;
          if (nodeAfter && EMBEDDED_BLOCK_TYPES.has(nodeAfter.type.name)) {
            if (dispatch) {
              const pos = $from.pos;
              const patch: Record<string, unknown> = { align };
              if (nodeAfter.attrs.blockWidth == null) patch.blockWidth = 75;
              const tr = state.tr.setNodeMarkup(pos, undefined, {
                ...nodeAfter.attrs,
                ...patch,
              });
              dispatch(tr);
            }
            return true;
          }

          // Node immediately before the cursor
          const nodeBefore = $from.nodeBefore;
          if (nodeBefore && EMBEDDED_BLOCK_TYPES.has(nodeBefore.type.name)) {
            if (dispatch) {
              const pos = $from.pos - nodeBefore.nodeSize;
              const patch: Record<string, unknown> = { align };
              if (nodeBefore.attrs.blockWidth == null) patch.blockWidth = 75;
              const tr = state.tr.setNodeMarkup(pos, undefined, {
                ...nodeBefore.attrs,
                ...patch,
              });
              dispatch(tr);
            }
            return true;
          }

          return false;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.setEmbeddedBlockAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setEmbeddedBlockAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setEmbeddedBlockAlign("right"),
    };
  },
});
