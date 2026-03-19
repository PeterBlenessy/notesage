import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { parseMarkdownToHtmlFull } from '@/lib/pm-replace';

export interface AISuggestion {
  from: number;
  to: number;
  originalText: string;
  suggestedText: string;
}

export interface AISuggestionOptions {
  onAccept?: () => void;
  onReject?: () => void;
}

export const AISuggestionPluginKey = new PluginKey('aiSuggestion');

export const AISuggestion = Extension.create<AISuggestionOptions>({
  name: 'aiSuggestion',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: AISuggestionPluginKey,
        state: {
          init() {
            return {
              suggestion: null as AISuggestion | null,
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, value, _oldState, newState) {
            const meta = tr.getMeta(AISuggestionPluginKey);

            if (meta?.setSuggestion) {
              const suggestion = meta.suggestion as AISuggestion;
              const decorations = createDiffDecorations(
                newState.doc,
                suggestion,
                editor
              );
              return { suggestion, decorations };
            }

            if (meta?.clearSuggestion) {
              return {
                suggestion: null,
                decorations: DecorationSet.empty,
              };
            }

            // Map decorations through document changes
            if (value.suggestion && tr.docChanged) {
              const decorations = value.decorations.map(tr.mapping, tr.doc);
              return { ...value, decorations };
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => {
        const suggestion = AISuggestionPluginKey.getState(this.editor.state)?.suggestion;
        if (suggestion) {
          acceptSuggestion(this.editor, suggestion);
          this.options.onAccept?.();
          return true;
        }
        return false;
      },
      'Mod-Backspace': () => {
        const suggestion = AISuggestionPluginKey.getState(this.editor.state)?.suggestion;
        if (suggestion) {
          rejectSuggestion(this.editor);
          this.options.onReject?.();
          return true;
        }
        return false;
      },
    };
  },
});

// Create decorations showing diff between original and suggested text
function createDiffDecorations(
  doc: import('@tiptap/pm/model').Node,
  suggestion: AISuggestion,
  editor: Editor
): DecorationSet {
  console.log('Creating decorations for suggestion:', suggestion);

  const decorations: Decoration[] = [];

  // Highlight the old text with red background
  decorations.push(
    Decoration.inline(suggestion.from, suggestion.to, {
      class: 'ai-suggestion-delete',
    })
  );

  // Add new text and controls in one widget to keep them together
  decorations.push(
    Decoration.widget(suggestion.to, () => {
      const container = document.createElement('span');
      container.className = 'ai-suggestion-widget';

      // New text — render parsed markdown HTML so formatting is visible
      const newText = document.createElement('span');
      newText.className = 'ai-suggestion-insert';
      const parsedHtml = parseMarkdownToHtmlFull(editor, suggestion.suggestedText);
      if (parsedHtml) {
        newText.innerHTML = parsedHtml;
      } else {
        newText.textContent = suggestion.suggestedText;
      }

      // Controls (small inline buttons)
      const controls = document.createElement('span');
      controls.className = 'ai-suggestion-controls';

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'ai-suggestion-accept';
      acceptBtn.textContent = '✓ Accept';
      acceptBtn.title = 'Cmd+Enter';
      acceptBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        acceptSuggestion(editor, suggestion);
      };

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'ai-suggestion-reject';
      rejectBtn.textContent = '✗ Reject';
      rejectBtn.title = 'Cmd+Backspace';
      rejectBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        rejectSuggestion(editor);
      };

      controls.appendChild(acceptBtn);
      controls.appendChild(rejectBtn);
      container.appendChild(newText);
      container.appendChild(controls);

      return container;
    })
  );

  console.log('Created', decorations.length, 'decorations');
  return DecorationSet.create(doc, decorations);
}

// Accept the suggestion
function acceptSuggestion(editor: Editor, suggestion: AISuggestion) {
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      // Parse markdown to full HTML for proper formatting (bold, tables, code, etc.)
      const html = parseMarkdownToHtmlFull(editor, suggestion.suggestedText);
      if (html) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        const slice = PMDOMParser.fromSchema(editor.schema).parseSlice(wrapper);
        tr.replace(suggestion.from, suggestion.to, slice);
      } else {
        // Plain text fallback: single-step replace preserving positional marks
        tr.insertText(suggestion.suggestedText, suggestion.from, suggestion.to);
      }
      return true;
    })
    .setMeta(AISuggestionPluginKey, { clearSuggestion: true })
    .run();
}

// Reject the suggestion
function rejectSuggestion(editor: any) {
  editor
    .chain()
    .focus()
    .setMeta(AISuggestionPluginKey, { clearSuggestion: true })
    .run();
}

// Helper to set a suggestion from outside
export function setSuggestion(
  editor: any,
  from: number,
  to: number,
  originalText: string,
  suggestedText: string
) {
  console.log('Setting AI suggestion:', { from, to, originalText, suggestedText });

  editor.view.dispatch(
    editor.state.tr.setMeta(AISuggestionPluginKey, {
      setSuggestion: true,
      suggestion: { from, to, originalText, suggestedText },
    })
  );

  console.log('Suggestion set, forcing update');
  editor.view.updateState(editor.state);
}

// Helper to clear suggestion
export function clearSuggestion(editor: any) {
  editor.view.dispatch(
    editor.state.tr.setMeta(AISuggestionPluginKey, {
      clearSuggestion: true,
    })
  );
}

// Helper to check if there's an active suggestion
export function hasActiveSuggestion(editor: any): boolean {
  return !!AISuggestionPluginKey.getState(editor.state)?.suggestion;
}
