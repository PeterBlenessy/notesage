import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Comment } from '@/stores/comment-store';

interface CommentDecoration {
  commentId: string;
  from: number;
  to: number;
  status?: string;
}

interface CommentMarkState {
  comments: CommentDecoration[];
  decorations: DecorationSet;
  activeCommentId: string | null;
  /** Range being commented on before the comment is saved */
  pendingRange: { from: number; to: number } | null;
}

export const CommentMarkPluginKey = new PluginKey('commentMark');

export const CommentMark = Extension.create({
  name: 'commentMark',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: CommentMarkPluginKey,
        state: {
          init(): CommentMarkState {
            return {
              comments: [],
              decorations: DecorationSet.empty,
              activeCommentId: null,
              pendingRange: null,
            };
          },
          apply(tr, value, _oldState, newState): CommentMarkState {
            const meta = tr.getMeta(CommentMarkPluginKey);

            if (meta?.setComments) {
              const comments = meta.comments as CommentDecoration[];
              const activeId = meta.activeCommentId ?? value.activeCommentId;
              const pending = value.pendingRange;
              const decorations = buildDecorations(newState.doc, comments, activeId, pending);
              return { comments, decorations, activeCommentId: activeId, pendingRange: pending };
            }

            if (meta?.setActiveComment !== undefined) {
              const activeId = meta.setActiveComment as string | null;
              const decorations = buildDecorations(newState.doc, value.comments, activeId, value.pendingRange);
              return { ...value, decorations, activeCommentId: activeId };
            }

            if (meta?.setPendingRange !== undefined) {
              const pending = meta.setPendingRange as { from: number; to: number } | null;
              const decorations = buildDecorations(newState.doc, value.comments, value.activeCommentId, pending);
              return { ...value, decorations, pendingRange: pending };
            }

            if (meta?.clearComments) {
              return {
                comments: [],
                decorations: DecorationSet.empty,
                activeCommentId: null,
                pendingRange: null,
              };
            }

            // Remap through document changes
            if (tr.docChanged && (value.comments.length > 0 || value.pendingRange)) {
              const mapped = value.comments.map((c) => ({
                ...c,
                from: tr.mapping.map(c.from, 1),
                to: tr.mapping.map(c.to, -1),
              })).filter((c) => c.from < c.to);

              let pending = value.pendingRange;
              if (pending) {
                pending = {
                  from: tr.mapping.map(pending.from, 1),
                  to: tr.mapping.map(pending.to, -1),
                };
                if (pending.from >= pending.to) pending = null;
              }

              const decorations = buildDecorations(newState.doc, mapped, value.activeCommentId, pending);
              return { comments: mapped, decorations, activeCommentId: value.activeCommentId, pendingRange: pending };
            }

            return value;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state)?.decorations;
          },
          handleClick(view, pos) {
            const state = CommentMarkPluginKey.getState(view.state);
            if (!state || state.comments.length === 0) return false;

            const clicked = (state.comments as CommentDecoration[]).find((c) => pos >= c.from && pos <= c.to);
            if (clicked) {
              view.dispatch(
                view.state.tr.setMeta(CommentMarkPluginKey, {
                  setActiveComment: clicked.commentId,
                })
              );
              return false;
            }
            return false;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-m': () => {
        const { from, to } = this.editor.state.selection;
        if (from === to) return false;

        this.editor.view.dispatch(
          this.editor.state.tr.setMeta(CommentMarkPluginKey, {
            requestCreateComment: { from, to },
          })
        );
        return true;
      },
    };
  },
});

function buildDecorations(
  doc: PMNode,
  comments: CommentDecoration[],
  activeCommentId: string | null,
  pendingRange: { from: number; to: number } | null
): DecorationSet {
  const decorations: Decoration[] = [];

  // Pending range (being created)
  if (pendingRange && pendingRange.from < pendingRange.to) {
    const from = Math.max(0, Math.min(pendingRange.from, doc.content.size));
    const to = Math.max(from, Math.min(pendingRange.to, doc.content.size));
    if (from < to) {
      decorations.push(
        Decoration.inline(from, to, {
          class: 'comment-highlight comment-highlight-active',
        })
      );
    }
  }

  // Saved comments
  for (const comment of comments) {
    if (comment.from >= comment.to) continue;
    const from = Math.max(0, Math.min(comment.from, doc.content.size));
    const to = Math.max(from, Math.min(comment.to, doc.content.size));
    if (from >= to) continue;

    const isActive = comment.commentId === activeCommentId;
    let className = 'comment-highlight';
    if (isActive) className += ' comment-highlight-active';
    if (comment.status === 'delegated') className += ' comment-highlight-delegated';
    decorations.push(
      Decoration.inline(from, to, {
        class: className,
        'data-comment-id': comment.commentId,
      })
    );
  }

  if (decorations.length === 0) return DecorationSet.empty;
  return DecorationSet.create(doc, decorations);
}

// --- Exported helpers ---

/** Set all comment decorations from a comment list. */
export function setCommentDecorations(
  editor: Editor,
  comments: Comment[],
  activeCommentId?: string | null
) {
  const mapped: CommentDecoration[] = comments
    .filter((c) => c.from < c.to)
    .map((c) => ({
      commentId: c.id,
      from: c.from,
      to: c.to,
      status: c.status,
    }));

  editor.view.dispatch(
    editor.state.tr.setMeta(CommentMarkPluginKey, {
      setComments: true,
      comments: mapped,
      activeCommentId: activeCommentId ?? null,
    })
  );
}

/** Clear all comment decorations. */
export function clearCommentDecorations(editor: Editor) {
  editor.view.dispatch(
    editor.state.tr.setMeta(CommentMarkPluginKey, {
      clearComments: true,
    })
  );
}

/** Set the active (highlighted) comment. */
export function setActiveCommentDecoration(editor: Editor, commentId: string | null) {
  editor.view.dispatch(
    editor.state.tr.setMeta(CommentMarkPluginKey, {
      setActiveComment: commentId,
    })
  );
}

/** Set or clear the pending comment range (highlight shown during creation). */
export function setPendingCommentRange(editor: Editor, range: { from: number; to: number } | null) {
  editor.view.dispatch(
    editor.state.tr.setMeta(CommentMarkPluginKey, {
      setPendingRange: range,
    })
  );
}

/** Find the comment at a given position, if any. */
export function getCommentAtPos(editor: Editor, pos: number): string | null {
  const state = CommentMarkPluginKey.getState(editor.state);
  if (!state) return null;
  const found = state.comments.find((c: CommentDecoration) => pos >= c.from && pos <= c.to);
  return found?.commentId ?? null;
}

/** Get the current comment plugin state. */
export function getCommentMarkState(editor: Editor): CommentMarkState | null {
  return CommentMarkPluginKey.getState(editor.state) ?? null;
}
