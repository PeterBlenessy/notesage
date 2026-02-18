import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { hasActiveSuggestion } from './ai-suggestion';

/**
 * A diff hunk mapped to ProseMirror positions, ready for inline display.
 */
export interface InlineDiffHunk {
  /** Unique hunk identifier (e.g., "hunk-0") */
  id: string;
  /** Start of the affected range in the PM document */
  from: number;
  /** End of the affected range in the PM document */
  to: number;
  /** Text currently at from..to that would be deleted (empty for pure insertions) */
  deleteText: string;
  /** Text to insert in place of deleteText (empty for pure deletions) */
  insertText: string;
}

interface InlineDiffState {
  hunks: InlineDiffHunk[];
  decorations: DecorationSet;
  active: boolean;
}

export const InlineDiffPluginKey = new PluginKey('inlineDiff');

export const InlineDiff = Extension.create({
  name: 'inlineDiff',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: InlineDiffPluginKey,
        state: {
          init(): InlineDiffState {
            return {
              hunks: [],
              decorations: DecorationSet.empty,
              active: false,
            };
          },
          apply(tr, value: InlineDiffState, _oldState, newState): InlineDiffState {
            const meta = tr.getMeta(InlineDiffPluginKey);

            // Show new diff hunks
            if (meta?.showDiff) {
              const hunks = meta.hunks as InlineDiffHunk[];
              const decorations = buildDiffDecorations(newState.doc, hunks, editor);
              return { hunks, decorations, active: true };
            }

            // Clear all diff decorations
            if (meta?.clearDiff) {
              return { hunks: [], decorations: DecorationSet.empty, active: false };
            }

            // Accept a single hunk: remove it and remap remaining positions
            if (meta?.acceptHunk) {
              const remainingHunks = value.hunks
                .filter(h => h.id !== meta.acceptHunk)
                .map(h => ({
                  ...h,
                  from: tr.mapping.map(h.from),
                  to: tr.mapping.map(h.to),
                }));

              if (remainingHunks.length === 0) {
                return { hunks: [], decorations: DecorationSet.empty, active: false };
              }

              const decorations = buildDiffDecorations(newState.doc, remainingHunks, editor);
              return { hunks: remainingHunks, decorations, active: true };
            }

            // Reject a single hunk: remove it (no text change)
            if (meta?.rejectHunk) {
              const remainingHunks = value.hunks.filter(h => h.id !== meta.rejectHunk);

              if (remainingHunks.length === 0) {
                return { hunks: [], decorations: DecorationSet.empty, active: false };
              }

              const decorations = buildDiffDecorations(newState.doc, remainingHunks, editor);
              return { hunks: remainingHunks, decorations, active: true };
            }

            // Map decorations and hunk positions through other document changes
            if (value.active && tr.docChanged) {
              const hunks = value.hunks.map(h => ({
                ...h,
                from: tr.mapping.map(h.from),
                to: tr.mapping.map(h.to),
              }));
              const decorations = value.decorations.map(tr.mapping, tr.doc);
              return { hunks, decorations, active: true };
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
        // AI suggestion takes priority
        if (hasActiveSuggestion(this.editor)) return false;

        const state = InlineDiffPluginKey.getState(this.editor.state) as InlineDiffState | undefined;
        if (state?.active && state.hunks.length > 0) {
          // Accept the topmost (lowest position) unresolved hunk
          const nextHunk = state.hunks.reduce((min, h) => (h.from < min.from ? h : min));
          acceptDiffHunk(this.editor, nextHunk.id);
          return true;
        }
        return false;
      },
      'Mod-Backspace': () => {
        // AI suggestion takes priority
        if (hasActiveSuggestion(this.editor)) return false;

        const state = InlineDiffPluginKey.getState(this.editor.state) as InlineDiffState | undefined;
        if (state?.active && state.hunks.length > 0) {
          // Reject the topmost (lowest position) unresolved hunk
          const nextHunk = state.hunks.reduce((min, h) => (h.from < min.from ? h : min));
          rejectDiffHunk(this.editor, nextHunk.id);
          return true;
        }
        return false;
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Decoration builders
// ---------------------------------------------------------------------------

/**
 * Build ProseMirror decorations for all diff hunks.
 *
 * Each hunk produces:
 * - Deleted text: Decoration.inline with red strikethrough
 * - Widget: inserted text (green) + accept/reject controls
 */
function buildDiffDecorations(
  doc: PMNode,
  hunks: InlineDiffHunk[],
  editor: Editor
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const hunk of hunks) {
    // Deleted text: strikethrough inline decoration
    if (hunk.deleteText && hunk.from < hunk.to) {
      decorations.push(
        Decoration.inline(hunk.from, hunk.to, {
          class: 'inline-diff-delete',
        })
      );
    }

    // Widget: inserted text + accept/reject controls
    const widgetPos = hunk.from < hunk.to ? hunk.to : hunk.from;
    decorations.push(
      Decoration.widget(
        widgetPos,
        () => createHunkWidget(hunk, editor),
        {
          key: `inline-diff-${hunk.id}`,
          side: 1,
        }
      )
    );
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Create the DOM widget for a single diff hunk.
 * Shows the inserted text (if any) plus accept/reject buttons.
 */
function createHunkWidget(hunk: InlineDiffHunk, editor: Editor): HTMLElement {
  const container = document.createElement('span');
  container.className = 'inline-diff-widget';

  // Inserted text
  if (hunk.insertText) {
    const insertSpan = document.createElement('span');
    insertSpan.className = 'inline-diff-insert';
    insertSpan.textContent = hunk.insertText;
    container.appendChild(insertSpan);
  }

  // Accept/reject controls
  const controls = document.createElement('span');
  controls.className = 'inline-diff-controls';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'inline-diff-accept-btn';
  acceptBtn.textContent = '✓';
  acceptBtn.title = 'Accept change (Cmd+Enter)';
  acceptBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    acceptDiffHunk(editor, hunk.id);
  };

  const rejectBtn = document.createElement('button');
  rejectBtn.className = 'inline-diff-reject-btn';
  rejectBtn.textContent = '✗';
  rejectBtn.title = 'Reject change (Cmd+Backspace)';
  rejectBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    rejectDiffHunk(editor, hunk.id);
  };

  controls.appendChild(acceptBtn);
  controls.appendChild(rejectBtn);
  container.appendChild(controls);

  return container;
}

// ---------------------------------------------------------------------------
// Public helpers — call from outside the extension
// ---------------------------------------------------------------------------

/**
 * Show inline diff decorations for the given hunks.
 * Replaces any existing diff decorations.
 */
export function showInlineDiff(editor: Editor, hunks: InlineDiffHunk[]): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(InlineDiffPluginKey, { showDiff: true, hunks })
  );
}

/**
 * Remove all inline diff decorations.
 */
export function clearInlineDiff(editor: Editor): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(InlineDiffPluginKey, { clearDiff: true })
  );
}

/**
 * Accept a single diff hunk: apply the text change and remove the hunk.
 * Remaining hunks' positions are automatically remapped.
 */
export function acceptDiffHunk(editor: Editor, hunkId: string): void {
  const state = InlineDiffPluginKey.getState(editor.state) as InlineDiffState | undefined;
  const hunk = state?.hunks.find(h => h.id === hunkId);
  if (!hunk) return;

  const tr = editor.state.tr;

  if (hunk.deleteText && hunk.insertText) {
    // Replacement: replace range with new text
    tr.insertText(hunk.insertText, hunk.from, hunk.to);
  } else if (hunk.deleteText) {
    // Pure deletion
    tr.delete(hunk.from, hunk.to);
  } else if (hunk.insertText) {
    // Pure insertion
    tr.insertText(hunk.insertText, hunk.from);
  }

  tr.setMeta(InlineDiffPluginKey, { acceptHunk: hunkId });
  editor.view.dispatch(tr);
}

/**
 * Reject a single diff hunk: remove the decoration, keep current text unchanged.
 */
export function rejectDiffHunk(editor: Editor, hunkId: string): void {
  editor.view.dispatch(
    editor.state.tr.setMeta(InlineDiffPluginKey, { rejectHunk: hunkId })
  );
}

/**
 * Accept all remaining diff hunks. Applies changes bottom-to-top
 * so earlier positions aren't affected by later changes.
 */
export function acceptAllDiffHunks(editor: Editor): void {
  const state = InlineDiffPluginKey.getState(editor.state) as InlineDiffState | undefined;
  if (!state?.active || state.hunks.length === 0) return;

  // Sort bottom-to-top (highest position first) so earlier positions aren't
  // affected by later changes within the same transaction.
  const sorted = [...state.hunks].sort((a, b) => b.from - a.from);

  const tr = editor.state.tr;
  for (const hunk of sorted) {
    if (hunk.deleteText && hunk.insertText) {
      tr.insertText(hunk.insertText, hunk.from, hunk.to);
    } else if (hunk.deleteText) {
      tr.delete(hunk.from, hunk.to);
    } else if (hunk.insertText) {
      tr.insertText(hunk.insertText, hunk.from);
    }
  }
  tr.setMeta(InlineDiffPluginKey, { clearDiff: true });
  editor.view.dispatch(tr);
}

/**
 * Reject all remaining diff hunks. Clears decorations, keeps text unchanged.
 */
export function rejectAllDiffHunks(editor: Editor): void {
  clearInlineDiff(editor);
}

/**
 * Check if there are active inline diff decorations.
 */
export function hasActiveInlineDiff(editor: Editor): boolean {
  const state = InlineDiffPluginKey.getState(editor.state) as InlineDiffState | undefined;
  return !!state?.active;
}

/**
 * Get the current list of unresolved diff hunks.
 */
export function getInlineDiffHunks(editor: Editor): InlineDiffHunk[] {
  const state = InlineDiffPluginKey.getState(editor.state) as InlineDiffState | undefined;
  return state?.hunks ?? [];
}
