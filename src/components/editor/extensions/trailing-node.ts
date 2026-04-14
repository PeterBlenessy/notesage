/**
 * Trailing Node extension — ensures there is always an empty paragraph at the
 * end of the document so users can click below the last block (table, code
 * block, image, etc.) to continue writing.
 *
 * The trailing paragraph is purely a UX affordance and is NOT serialized to
 * markdown — the `tiptap-markdown` package skips empty trailing paragraphs by
 * default, and we avoid triggering the `onUpdate` callback for trailing-node
 * transactions.
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

const trailingNodePluginKey = new PluginKey('trailingNode');

export const TrailingNode = Extension.create({
  name: 'trailingNode',

  addProseMirrorPlugins() {
    const nodeType = this.editor.schema.nodes.paragraph;

    return [
      new Plugin({
        key: trailingNodePluginKey,
        appendTransaction(_transactions, _oldState, newState) {
          const { doc } = newState;
          const lastChild = doc.lastChild;

          // If the document is empty or the last child is already an empty
          // paragraph, no action needed.
          if (!lastChild) return null;
          if (lastChild.type.name === 'paragraph' && lastChild.content.size === 0) {
            return null;
          }

          // Append an empty paragraph at the end of the document
          return newState.tr.insert(doc.content.size, nodeType.create());
        },
      }),
    ];
  },
});
