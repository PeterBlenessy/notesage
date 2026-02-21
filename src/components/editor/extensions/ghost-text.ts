import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { hasActiveInlineDiff } from './inline-diff';
import { hasActiveSuggestion } from './ai-suggestion';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GhostTextCompletion {
  /** The suggested text to insert */
  text: string;
  /** ProseMirror position where the ghost text starts */
  from: number;
  /** ProseMirror position where the ghost text ends (usually same as from for pure insertions) */
  to: number;
  /** LSP command to execute on acceptance (for tracking) */
  command?: { command: string; arguments?: unknown[] };
}

interface GhostTextState {
  completion: GhostTextCompletion | null;
  decorations: DecorationSet;
}

// ---------------------------------------------------------------------------
// Plugin key
// ---------------------------------------------------------------------------

export const GhostTextPluginKey = new PluginKey('ghostText');

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export const GhostText = Extension.create({
  name: 'ghostText',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: GhostTextPluginKey,
        state: {
          init(): GhostTextState {
            return {
              completion: null,
              decorations: DecorationSet.empty,
            };
          },
          apply(tr, value: GhostTextState, _oldState, newState): GhostTextState {
            const meta = tr.getMeta(GhostTextPluginKey);

            // Set new ghost text
            if (meta?.setGhostText) {
              const completion = meta.completion as GhostTextCompletion;
              const decorations = createGhostTextDecoration(newState.doc, completion);
              return { completion, decorations };
            }

            // Clear ghost text
            if (meta?.clearGhostText) {
              return { completion: null, decorations: DecorationSet.empty };
            }

            // Auto-dismiss on any document change (unless it's our own acceptance)
            if (value.completion && tr.docChanged && !meta?.ghostTextAccept) {
              return { completion: null, decorations: DecorationSet.empty };
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
      Tab: () => {
        const state = GhostTextPluginKey.getState(this.editor.state);
        if (!state?.completion) return false;

        // Don't capture Tab if inline diff or AI suggestion is active
        if (hasActiveInlineDiff(this.editor) || hasActiveSuggestion(this.editor)) {
          return false;
        }

        acceptGhostText(this.editor, state.completion);
        return true;
      },
      Escape: () => {
        const state = GhostTextPluginKey.getState(this.editor.state);
        if (!state?.completion) return false;

        clearGhostText(this.editor);
        return true;
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Decoration builder
// ---------------------------------------------------------------------------

function createGhostTextDecoration(
  doc: Parameters<typeof DecorationSet.create>[0],
  completion: GhostTextCompletion
): DecorationSet {
  // Validate position is within document bounds
  if (completion.from < 0 || completion.from > doc.content.size) {
    console.warn('[ghost-text] Position out of bounds:', completion.from, 'doc size:', doc.content.size);
    return DecorationSet.empty;
  }

  // Create a widget decoration at the cursor position
  const widget = Decoration.widget(
    completion.from,
    () => {
      const span = document.createElement('span');
      span.className = 'ghost-text';
      // Show first line only for inline display; full text on accept
      const firstLine = completion.text.split('\n')[0];
      span.textContent = firstLine;
      span.setAttribute('contenteditable', 'false');
      return span;
    },
    { side: 1 } // Render after content at this position
  );

  return DecorationSet.create(doc, [widget]);
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Show ghost text at the given position. */
export function setGhostText(editor: Editor, completion: GhostTextCompletion) {
  editor.view.dispatch(
    editor.state.tr.setMeta(GhostTextPluginKey, {
      setGhostText: true,
      completion,
    })
  );
}

/** Clear any visible ghost text. */
export function clearGhostText(editor: Editor) {
  const state = GhostTextPluginKey.getState(editor.state);
  if (!state?.completion) return;

  editor.view.dispatch(
    editor.state.tr.setMeta(GhostTextPluginKey, {
      clearGhostText: true,
    })
  );
}

/** Accept the current ghost text — insert it into the document. */
export function acceptGhostText(editor: Editor, completion: GhostTextCompletion) {
  const { from, to, text } = completion;

  // Insert the text and clear the ghost decoration in one transaction
  const tr = editor.state.tr;

  if (from !== to) {
    // Replace range
    tr.replaceWith(from, to, editor.state.schema.text(text));
  } else {
    // Pure insertion
    tr.insertText(text, from);
  }

  // Mark this transaction so the plugin doesn't auto-dismiss
  tr.setMeta(GhostTextPluginKey, { ghostTextAccept: true, clearGhostText: true });

  editor.view.dispatch(tr);
}

/** Check whether ghost text is currently visible. */
export function hasActiveGhostText(editor: Editor): boolean {
  return !!GhostTextPluginKey.getState(editor.state)?.completion;
}
