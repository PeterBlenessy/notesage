import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /**
       * Insert a page break at the current cursor position.
       */
      insertPageBreak: () => ReturnType;
    };
  }
}

export const PageBreakNode = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-page-break': '',
        class: 'page-break-node',
        contenteditable: 'false',
      }),
      ['span', { class: 'page-break-label' }, 'Page Break'],
    ];
  },

  addCommands() {
    return {
      insertPageBreak:
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
          s.write('<!-- pagebreak -->');
          s.closeBlock(node);
        },
        parse: {
          // Handled by parseHTML above — tiptap-markdown passes HTML through
        },
      },
    };
  },
});
