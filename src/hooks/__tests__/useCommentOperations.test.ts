// @vitest-environment jsdom
/**
 * useCommentOperations against a real Tiptap editor, the real comment store
 * and an in-memory file system: re-anchoring of stale ranges on load, the
 * debounced position save, and the two render/transaction budgets (the hook
 * runs inside Editor, so every extra render or dispatch is paid per keystroke
 * or per streamed chunk).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@/test/tauri-mock';
import { setMockInvokeHandler } from '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import { CommentMark, CommentMarkPluginKey } from '@/components/editor/extensions/comment-mark';
import { useCommentOperations } from '@/hooks/useCommentOperations';
import { useCommentStore, appendPartialReply } from '@/stores/comment-store';
import type { Comment } from '@/stores/comment-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { hashPath } from '@/lib/comment-storage';

const NOTES = '/Users/tester/Notesage';
const FILE = `${NOTES}/doc.md`;
const KEY = hashPath(FILE);
const SIDECAR = `${NOTES}/.notesage/comments/${KEY}.json`;

let files: Map<string, string>;
let sidecarWrites: Comment[][];
let editor: Editor;

function makeComment(overrides: Partial<Comment> & Pick<Comment, 'id' | 'anchorText' | 'from' | 'to'>): Comment {
  return {
    documentId: KEY,
    body: 'body',
    author: 'You',
    timestamp: 1,
    replies: [],
    status: 'open',
    ...overrides,
  } as Comment;
}

function seedSidecar(comments: Comment[]) {
  files.set(SIDECAR, JSON.stringify(comments));
}

function storeComments(): Comment[] {
  return useCommentStore.getState().commentsByDocument[KEY] ?? [];
}

function pluginComments(): Array<{ commentId: string; from: number; to: number }> {
  const state = CommentMarkPluginKey.getState(editor.state) as {
    comments: Array<{ commentId: string; from: number; to: number }>;
  };
  return state.comments;
}

function textAt(range: { from: number; to: number }): string {
  return editor.state.doc.textBetween(range.from, range.to, '\n');
}

/** Let the load promise chain and the effects it triggers run to rest. */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('useCommentOperations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    files = new Map();
    sidecarWrites = [];
    setMockInvokeHandler('read_file', (args) => {
      const content = files.get(String(args?.path));
      if (content === undefined) throw new Error('no such file');
      return content;
    });
    setMockInvokeHandler('write_file', (args) => {
      const path = String(args?.path);
      files.set(path, String(args?.content));
      if (path === SIDECAR) {
        const parsed = JSON.parse(String(args?.content)) as { comments: Comment[] } | Comment[];
        sidecarWrites.push(Array.isArray(parsed) ? parsed : parsed.comments);
      }
    });
    setMockInvokeHandler('path_exists', (args) => {
      const path = String(args?.path);
      return files.has(path) || [...files.keys()].some((f) => f.startsWith(`${path}/`));
    });
    setMockInvokeHandler('create_directory', () => undefined);

    useCommentStore.setState({
      commentsByDocument: {},
      loadFailedByDocument: {},
      activeCommentId: null,
      activitiesByComment: {},
      delegationModeByComment: {},
    });
    useWorkspaceStore.setState({ projects: [] });
    useSettingsStore.setState({ notesRootPath: NOTES });
    useEditorStore.setState({
      openDocuments: [{
        id: 'tab-1',
        filePath: FILE,
        fileName: 'doc.md',
        isDirty: false,
        content: '',
        frontmatter: null,
        fileType: 'markdown' as const,
        contentLoaded: true,
      }],
      activeTabId: 'tab-1',
    });

    const el = document.createElement('div');
    document.body.appendChild(el);
    editor = new Editor({
      element: el,
      extensions: [StarterKit, CommentMark],
      content: '<p>Alpha beta gamma.</p><p>Second paragraph.</p>',
    });
  });

  afterEach(() => {
    editor.destroy();
    vi.useRealTimers();
  });

  describe('re-anchoring on load', () => {
    it('moves a stale range to where its anchor text is, in the store, the editor and on disk', async () => {
      // Raw-file offsets, as written for a file that was not open at the time.
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 40, to: 44 })]);

      renderHook(() => useCommentOperations(editor));
      await settle();

      const [c] = storeComments();
      expect(textAt(c)).toBe('beta');
      expect(pluginComments()).toEqual([expect.objectContaining({ commentId: 'c1', from: c.from, to: c.to })]);
      expect(sidecarWrites).toHaveLength(1);
      expect(sidecarWrites[0][0]).toMatchObject({ id: 'c1', from: c.from, to: c.to });
    });

    it('leaves a range that already matches its anchor alone and does not save', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'Alpha', from: 1, to: 6 })]);

      renderHook(() => useCommentOperations(editor));
      await settle();

      expect(storeComments()[0]).toMatchObject({ from: 1, to: 6 });
      expect(pluginComments()).toEqual([expect.objectContaining({ commentId: 'c1', from: 1, to: 6 })]);
      expect(sidecarWrites).toEqual([]);
    });

    it('skips resolved comments', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 40, to: 44, status: 'resolved' })]);

      renderHook(() => useCommentOperations(editor));
      await settle();

      expect(storeComments()[0]).toMatchObject({ from: 40, to: 44 });
      expect(pluginComments()).toEqual([]);
      expect(sidecarWrites).toEqual([]);
    });

    it('keeps the stored range when the anchor text is no longer in the document', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'deleted words', from: 3, to: 9 })]);

      renderHook(() => useCommentOperations(editor));
      await settle();

      expect(storeComments()[0]).toMatchObject({ from: 3, to: 9, anchorText: 'deleted words' });
      expect(sidecarWrites).toEqual([]);
    });
  });

  describe('position persistence', () => {
    it('saves once, 2s after the last edit, with the shifted range', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      renderHook(() => useCommentOperations(editor));
      await settle();
      expect(sidecarWrites).toEqual([]);

      await act(async () => { editor.commands.insertContentAt(1, 'XY'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
      await act(async () => { editor.commands.insertContentAt(1, 'Z'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
      expect(sidecarWrites).toEqual([]);

      await act(async () => { await vi.advanceTimersByTimeAsync(1); });

      expect(sidecarWrites).toHaveLength(1);
      expect(sidecarWrites[0][0]).toMatchObject({ id: 'c1', from: 10, to: 14, anchorText: 'beta' });
      expect(storeComments()[0]).toMatchObject({ from: 10, to: 14 });
    });

    it('updates the anchor text when the commented text itself is edited', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      renderHook(() => useCommentOperations(editor));
      await settle();

      await act(async () => { editor.commands.insertContentAt(9, '--'); });
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

      expect(sidecarWrites[0][0]).toMatchObject({ from: 7, to: 13, anchorText: 'be--ta' });
    });

    it('saves immediately on unmount when an edit is still waiting for the debounce', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      const { unmount } = renderHook(() => useCommentOperations(editor));
      await settle();

      await act(async () => { editor.commands.insertContentAt(1, 'X'); });
      unmount();
      await settle();

      expect(sidecarWrites).toHaveLength(1);
      expect(sidecarWrites[0][0]).toMatchObject({ from: 8, to: 12 });
    });
  });

  describe('transactions per keystroke', () => {
    function countTransactions() {
      const metas: unknown[] = [];
      const handler = ({ transaction }: { transaction: Transaction }) => {
        const meta: unknown = transaction.getMeta(CommentMarkPluginKey);
        metas.push(meta ?? null);
      };
      editor.on('transaction', handler);
      return { metas, stop: () => editor.off('transaction', handler) };
    }

    it('typing before a comment dispatches only the typing transaction', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      renderHook(() => useCommentOperations(editor));
      await settle();

      const counter = countTransactions();
      await act(async () => { editor.commands.insertContentAt(1, 'X'); });
      await settle();
      counter.stop();

      // The store did catch up with the shifted range...
      expect(storeComments()[0]).toMatchObject({ from: 8, to: 12 });
      // ...without a follow-up setComments transaction.
      expect(counter.metas).toEqual([null]);
      expect(pluginComments()).toEqual([expect.objectContaining({ commentId: 'c1', from: 8, to: 12 })]);
    });

    it('a comment written to another document does not touch this editor', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      renderHook(() => useCommentOperations(editor));
      await settle();

      const counter = countTransactions();
      await act(async () => {
        useCommentStore.getState().addComment({
          documentId: 'another-doc', anchorText: 'x', from: 1, to: 2, body: 'b', author: 'You',
        });
      });
      counter.stop();

      expect(counter.metas).toEqual([]);
    });

    it('still redraws for what the plugin cannot know: a new comment, a status, the active comment', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      const { result } = renderHook(() => useCommentOperations(editor));
      await settle();

      await act(async () => { await result.current.createComment('new', 1, 6); });
      const created = storeComments().find((c) => c.body === 'new');
      expect(pluginComments().map((c) => c.commentId)).toEqual(['c1', created?.id]);

      await act(async () => { useCommentStore.getState().setCommentStatus(KEY, 'c1', 'resolved'); });
      expect(pluginComments().map((c) => c.commentId)).toEqual([created?.id]);

      await act(async () => { useCommentStore.getState().setActiveComment(null); });
      await act(async () => { useCommentStore.getState().setActiveComment(created?.id ?? null); });
      const state = CommentMarkPluginKey.getState(editor.state) as { activeCommentId: string | null };
      expect(state.activeCommentId).toBe(created?.id);
    });
  });

  describe('renders', () => {
    it('does not re-render for delegation stream chunks, activities or other documents', async () => {
      seedSidecar([makeComment({ id: 'c1', anchorText: 'beta', from: 7, to: 11 })]);
      let renders = 0;
      renderHook(() => {
        renders += 1;
        return useCommentOperations(editor);
      });
      await settle();
      const before = renders;

      await act(async () => {
        for (let i = 0; i < 20; i++) appendPartialReply(KEY, 'c1', `chunk ${i} `);
        useCommentStore.getState().addActivity('c1', { label: 'Reading', status: 'running', timestamp: 1 });
        useCommentStore.getState().addComment({
          documentId: 'another-doc', anchorText: 'x', from: 1, to: 2, body: 'b', author: 'You',
        });
      });

      expect(renders).toBe(before);
    });

    it('re-renders when this document gets a comment', async () => {
      seedSidecar([]);
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useCommentOperations(editor);
      });
      await settle();
      const before = renders;

      await act(async () => {
        useCommentStore.getState().addComment({
          documentId: KEY, anchorText: 'Alpha', from: 1, to: 6, body: 'b', author: 'You',
        });
      });

      expect(renders).toBeGreaterThan(before);
      expect(result.current.comments).toHaveLength(1);
    });
  });

  describe('document id', () => {
    function openProjectDoc(frontmatter: Record<string, unknown> | null) {
      const project = '/Users/tester/Projects/alpha';
      useWorkspaceStore.setState({ projects: [{ path: project, fileTree: [] }] });
      useEditorStore.setState((s) => ({
        openDocuments: s.openDocuments.map((d) => ({ ...d, filePath: `${project}/doc.md`, frontmatter })),
      }));
    }

    it('uses a safe frontmatter id as the comment key', async () => {
      openProjectDoc({ id: 'doc-uuid-1' });
      const { result } = renderHook(() => useCommentOperations(editor));
      await settle();

      expect(result.current.documentId).toBe('doc-uuid-1');
      expect(result.current.commentKey).toBe('doc-uuid-1');
    });

    it.each([
      ['a traversal path', '../../outside'],
      ['an object', { a: 1 }],
      ['a list', ['x']],
    ])('treats %s as no id, so nothing is keyed or written under it', async (_label, id) => {
      openProjectDoc({ id });
      const { result } = renderHook(() => useCommentOperations(editor));
      await settle();

      expect(result.current.documentId).toBeNull();
      expect(result.current.commentKey).toBeNull();
      expect(await result.current.createComment('body', 1, 6)).toBeNull();
      expect([...files.keys()]).toEqual([]);
    });
  });
});
