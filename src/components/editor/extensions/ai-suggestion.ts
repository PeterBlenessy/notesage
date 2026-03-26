import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import DOMPurify from 'dompurify';
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
        newText.innerHTML = DOMPurify.sanitize(parsedHtml);
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

      // Show/hide controls on hover over either the green (insert) or red (delete) area
      const showControls = () => controls.classList.add('visible');
      const hideControls = (e: MouseEvent) => {
        const related = e.relatedTarget as HTMLElement | null;
        if (
          related?.closest('.ai-suggestion-delete') ||
          related?.closest('.ai-suggestion-widget')
        ) {
          return; // Moving between red/green — keep visible
        }
        controls.classList.remove('visible');
      };

      container.addEventListener('mouseenter', showControls);
      container.addEventListener('mouseleave', hideControls as EventListener);

      // Delegate hover on the red (delete) decoration via the editor DOM
      const editorDom = editor.view.dom;
      const onOver = (e: Event) => {
        const target = (e as MouseEvent).target as HTMLElement;
        if (target.closest('.ai-suggestion-delete')) {
          showControls();
        }
      };
      const onOut = (e: Event) => {
        const me = e as MouseEvent;
        const target = me.target as HTMLElement;
        if (!target.closest('.ai-suggestion-delete')) return;
        const related = me.relatedTarget as HTMLElement | null;
        if (
          related?.closest('.ai-suggestion-delete') ||
          related?.closest('.ai-suggestion-widget')
        ) {
          return;
        }
        controls.classList.remove('visible');
      };
      editorDom.addEventListener('mouseover', onOver);
      editorDom.addEventListener('mouseout', onOut);

      // Clean up when the widget is removed from the DOM
      const observer = new MutationObserver(() => {
        if (!container.isConnected) {
          editorDom.removeEventListener('mouseover', onOver);
          editorDom.removeEventListener('mouseout', onOut);
          observer.disconnect();
        }
      });
      observer.observe(editorDom, { childList: true, subtree: true });

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
        wrapper.innerHTML = DOMPurify.sanitize(html);
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
function rejectSuggestion(editor: Editor) {
  editor
    .chain()
    .focus()
    .setMeta(AISuggestionPluginKey, { clearSuggestion: true })
    .run();
}

// Helper to set a suggestion from outside
export function setSuggestion(
  editor: Editor,
  from: number,
  to: number,
  originalText: string,
  suggestedText: string
) {
  console.log('Setting AI suggestion:', { from, to, originalText, suggestedText });

  // Absorb trailing punctuation: if the suggested text ends with the same
  // characters that immediately follow the selection in the document, extend
  // the selection range to include them. This prevents orphaned punctuation
  // (e.g. a "." appearing after the Accept/Reject controls).
  const doc = editor.state.doc;
  const docSize = doc.content.size;
  let adjustedTo = to;
  const trailingChars = '.!?;:,)]\'"';
  while (adjustedTo < docSize) {
    const nextChar = doc.textBetween(adjustedTo, adjustedTo + 1, '', '');
    if (!nextChar || !trailingChars.includes(nextChar)) break;
    if (!suggestedText.endsWith(nextChar)) break;
    // The suggested text already ends with this char — absorb it into the range
    adjustedTo++;
  }
  if (adjustedTo > to) {
    originalText = doc.textBetween(from, adjustedTo, '\n');
  }

  editor.view.dispatch(
    editor.state.tr.setMeta(AISuggestionPluginKey, {
      setSuggestion: true,
      suggestion: { from, to: adjustedTo, originalText, suggestedText },
    })
  );

  console.log('Suggestion set, forcing update');
  editor.view.updateState(editor.state);
}

// Helper to clear suggestion
export function clearSuggestion(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(AISuggestionPluginKey, {
      clearSuggestion: true,
    })
  );
}

// Helper to check if there's an active suggestion
export function hasActiveSuggestion(editor: Editor): boolean {
  return !!AISuggestionPluginKey.getState(editor.state)?.suggestion;
}
