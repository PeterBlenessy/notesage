import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

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
  doc: any,
  suggestion: AISuggestion,
  editor: any
): DecorationSet {
  console.log('Creating decorations for suggestion:', suggestion);

  const decorations: Decoration[] = [];

  // Strikethrough the old text with red background
  decorations.push(
    Decoration.inline(suggestion.from, suggestion.to, {
      class: 'ai-suggestion-delete',
      style: 'background-color: rgba(239, 68, 68, 0.15); text-decoration: line-through; color: rgb(220, 38, 38);',
    })
  );

  // Add new text and controls in one widget to keep them together
  decorations.push(
    Decoration.widget(suggestion.to, () => {
      const container = document.createElement('span');
      container.className = 'ai-suggestion-widget';
      container.style.cssText = 'display: inline; white-space: normal;';

      // New text (inline, only color changes)
      const newText = document.createElement('span');
      newText.className = 'ai-suggestion-insert';
      newText.style.cssText = 'background-color: rgba(34, 197, 94, 0.2); color: rgb(21, 128, 61);';
      newText.textContent = suggestion.suggestedText;

      // Controls (small inline buttons)
      const controls = document.createElement('span');
      controls.className = 'ai-suggestion-controls';
      controls.style.cssText = 'display: inline; margin-left: 6px; white-space: nowrap;';

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'ai-suggestion-accept';
      acceptBtn.textContent = '✓ Accept';
      acceptBtn.title = 'Cmd+Enter';
      acceptBtn.style.cssText = 'background: rgb(34, 197, 94); color: white; border: none; padding: 2px 6px; border-radius: 3px; font-size: 11px; cursor: pointer; margin: 0 2px; line-height: 1; font-weight: 500;';
      acceptBtn.onmouseover = () => acceptBtn.style.background = 'rgb(22, 163, 74)';
      acceptBtn.onmouseout = () => acceptBtn.style.background = 'rgb(34, 197, 94)';
      acceptBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        acceptSuggestion(editor, suggestion);
      };

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'ai-suggestion-reject';
      rejectBtn.textContent = '✗ Reject';
      rejectBtn.title = 'Cmd+Backspace';
      rejectBtn.style.cssText = 'background: rgb(239, 68, 68); color: white; border: none; padding: 2px 6px; border-radius: 3px; font-size: 11px; cursor: pointer; margin: 0 2px; line-height: 1; font-weight: 500;';
      rejectBtn.onmouseover = () => rejectBtn.style.background = 'rgb(220, 38, 38)';
      rejectBtn.onmouseout = () => rejectBtn.style.background = 'rgb(239, 68, 68)';
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
function acceptSuggestion(editor: any, suggestion: AISuggestion) {
  editor
    .chain()
    .focus()
    .deleteRange({ from: suggestion.from, to: suggestion.to })
    .insertContentAt(suggestion.from, suggestion.suggestedText)
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
