import { Extension } from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";

/**
 * The four embedded block node types that carry their own `align` attribute.
 * All four also carry `blockWidth`. This list is checked by
 * `setEmbeddedBlockAlign` to decide whether the current selection targets an
 * embedded block (handle it here) or a text node (return false, fall through
 * to `TextAlign`).
 *
 * MUST NOT add these types to `TextAlign.addGlobalAttributes`. That approach
 * was tried and reverted (commit ba4fe785) — it inflated every node's attr set
 * and slowed `streamingHydrate`'s `setContent` from ~3 s to ~12 s on a 494 KB
 * document (a 4x regression).
 */
const EMBEDDED_BLOCK_TYPES = new Set(["image", "chart", "drawing", "linkPreview"]);

/** Default block width applied when `blockWidth` is null on first alignment. */
const DEFAULT_BLOCK_WIDTH = 75;

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    embeddedBlockAlign: {
      /**
       * Set the `align` attribute on the currently focused embedded block
       * (image / chart / drawing / linkPreview). Returns `false` when the
       * selection is NOT on an embedded block, allowing callers to fall
       * through to `TextAlign.setTextAlign`.
       */
      setEmbeddedBlockAlign: (align: "left" | "center" | "right") => ReturnType;
    };
  }
}

export const EmbeddedBlockAlign = Extension.create({
  name: "embeddedBlockAlign",

  addCommands() {
    return {
      setEmbeddedBlockAlign:
        (align: "left" | "center" | "right") =>
        ({ state, dispatch }) => {
          const { selection } = state;

          let targetPos: number | null = null;
          let targetNode = null as ReturnType<typeof state.doc.nodeAt> | null;

          if (selection instanceof NodeSelection) {
            // NodeSelection: the user clicked on (or tabbed to) an atom block.
            const node = selection.node;
            if (EMBEDDED_BLOCK_TYPES.has(node.type.name)) {
              targetPos = selection.from;
              targetNode = node;
            }
          } else {
            // TextSelection: cursor is adjacent to an atom block (e.g. the
            // user pressed the keyboard shortcut while the cursor is in the
            // gap just before or after the block). Check $from.nodeBefore and
            // $from.nodeAfter.
            const { $from } = selection;
            const nodeBefore = $from.nodeBefore;
            const nodeAfter = $from.nodeAfter;

            if (nodeBefore && EMBEDDED_BLOCK_TYPES.has(nodeBefore.type.name)) {
              targetPos = $from.pos - nodeBefore.nodeSize;
              targetNode = nodeBefore;
            } else if (nodeAfter && EMBEDDED_BLOCK_TYPES.has(nodeAfter.type.name)) {
              targetPos = $from.pos;
              targetNode = nodeAfter;
            }
          }

          if (targetPos === null || targetNode === null) {
            // Not an embedded block — caller should fall through to TextAlign.
            return false;
          }

          if (dispatch) {
            const newAttrs = {
              ...targetNode.attrs,
              align,
              // Apply a default width so the block doesn't span 100% when
              // centred or right-aligned. Preserve any explicitly-set width.
              blockWidth: targetNode.attrs.blockWidth ?? DEFAULT_BLOCK_WIDTH,
            };
            dispatch(
              state.tr.setNodeMarkup(targetPos, undefined, newAttrs),
            );
          }
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      // These mirror TextAlign's default shortcuts for left / center / right.
      // Registering them here (AFTER TextAlign in useEditor.ts's extension
      // array) gives this handler HIGHER priority. When the focused node is an
      // embedded block, we handle it and stop propagation; otherwise we return
      // `false` so Tiptap continues to TextAlign's handler.
      "Mod-Shift-l": () =>
        this.editor.chain().focus().setEmbeddedBlockAlign("left").run() || false,
      "Mod-Shift-e": () =>
        this.editor.chain().focus().setEmbeddedBlockAlign("center").run() || false,
      "Mod-Shift-r": () =>
        this.editor.chain().focus().setEmbeddedBlockAlign("right").run() || false,
    };
  },
});
