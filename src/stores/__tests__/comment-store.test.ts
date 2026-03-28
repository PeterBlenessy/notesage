/**
 * Unit tests for comment-store.
 *
 * Covers: initial state, addComment, updateComment, deleteComment, addReply,
 * setCommentStatus, setTaskId, setLinkedConversation, activity management,
 * delegation mode, navigation, updateCommentPositions, loadComments,
 * saveComments, clearDocument, and module-level partial reply functions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    pathExists: vi.fn(),
    createDirectory: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import store and helpers AFTER mocks are set up
// ---------------------------------------------------------------------------

import { useCommentStore, appendPartialReply, getPartialReply, clearPartialReply } from '../comment-store';
import type { Comment, DelegationActivity } from '../comment-store';
import { tauriApi } from '@/lib/tauri';
import { toast } from 'sonner';
import { log } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockedTauriApi = vi.mocked(tauriApi);

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: overrides.id ?? 'comment-1',
    documentId: overrides.documentId ?? 'doc-1',
    anchorText: overrides.anchorText ?? 'some text',
    from: overrides.from ?? 10,
    to: overrides.to ?? 20,
    body: overrides.body ?? 'A comment',
    author: overrides.author ?? 'user',
    createdAt: overrides.createdAt ?? 1000,
    updatedAt: overrides.updatedAt ?? 1000,
    replies: overrides.replies,
    status: overrides.status,
    taskId: overrides.taskId,
    linkedConversationId: overrides.linkedConversationId,
  };
}

function seedComment(comment?: Partial<Comment>) {
  const c = makeComment(comment);
  useCommentStore.setState({
    commentsByDocument: { [c.documentId]: [c] },
  });
  return c;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('comment-store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCommentStore.setState({
      commentsByDocument: {},
      activeCommentId: null,
      scrollToCommentId: null,
      activitiesByComment: {},
      delegationModeByComment: {},
      partialReplyVersion: 0,
    });
    // Clear any lingering partial replies
    clearPartialReply('doc-1', 'comment-1');
    clearPartialReply('doc-1', 'comment-2');
    // Reset version after cleanup
    useCommentStore.setState({ partialReplyVersion: 0 });
  });

  // -----------------------------------------------------------------------
  // 1. Initial state
  // -----------------------------------------------------------------------

  describe('initial state', () => {
    it('has empty defaults', () => {
      const state = useCommentStore.getState();
      expect(state.commentsByDocument).toEqual({});
      expect(state.activeCommentId).toBeNull();
      expect(state.scrollToCommentId).toBeNull();
      expect(state.activitiesByComment).toEqual({});
      expect(state.delegationModeByComment).toEqual({});
      expect(state.partialReplyVersion).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  // 2. addComment
  // -----------------------------------------------------------------------

  describe('addComment', () => {
    it('creates a comment with UUID and timestamps', () => {
      const result = useCommentStore.getState().addComment({
        documentId: 'doc-1',
        anchorText: 'hello world',
        from: 5,
        to: 16,
        body: 'Nice text',
        author: 'user',
      });

      expect(result.id).toBeTruthy();
      expect(result.createdAt).toBeGreaterThan(0);
      expect(result.updatedAt).toBe(result.createdAt);
      expect(result.body).toBe('Nice text');

      const comments = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(result.id);
    });

    it('appends to existing comments for the document', () => {
      seedComment({ id: 'existing', documentId: 'doc-1' });

      useCommentStore.getState().addComment({
        documentId: 'doc-1',
        anchorText: 'more text',
        from: 30,
        to: 39,
        body: 'Second comment',
        author: 'user',
      });

      const comments = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(comments).toHaveLength(2);
    });

    it('creates new document entry if none exists', () => {
      useCommentStore.getState().addComment({
        documentId: 'new-doc',
        anchorText: 'text',
        from: 0,
        to: 4,
        body: 'First',
        author: 'user',
      });

      expect(useCommentStore.getState().commentsByDocument['new-doc']).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. updateComment
  // -----------------------------------------------------------------------

  describe('updateComment', () => {
    it('modifies body and updatedAt', () => {
      const c = seedComment({ updatedAt: 1000 });

      useCommentStore.getState().updateComment('doc-1', c.id, 'Updated body');

      const updated = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(updated.body).toBe('Updated body');
      expect(updated.updatedAt).toBeGreaterThan(1000);
    });

    it('does not affect other comments', () => {
      useCommentStore.setState({
        commentsByDocument: {
          'doc-1': [
            makeComment({ id: 'c1', body: 'First' }),
            makeComment({ id: 'c2', body: 'Second' }),
          ],
        },
      });

      useCommentStore.getState().updateComment('doc-1', 'c1', 'Changed');

      const comments = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(comments[0].body).toBe('Changed');
      expect(comments[1].body).toBe('Second');
    });
  });

  // -----------------------------------------------------------------------
  // 4. deleteComment
  // -----------------------------------------------------------------------

  describe('deleteComment', () => {
    it('removes the comment from the list', () => {
      seedComment({ id: 'c1' });

      useCommentStore.getState().deleteComment('doc-1', 'c1');

      expect(useCommentStore.getState().commentsByDocument['doc-1']).toHaveLength(0);
    });

    it('clears activities and delegation mode for deleted comment', () => {
      seedComment({ id: 'c1' });
      useCommentStore.setState({
        activitiesByComment: { c1: [{ label: 'test', status: 'running', timestamp: 1 }] },
        delegationModeByComment: { c1: 'chat' },
      });

      useCommentStore.getState().deleteComment('doc-1', 'c1');

      expect(useCommentStore.getState().activitiesByComment['c1']).toBeUndefined();
      expect(useCommentStore.getState().delegationModeByComment['c1']).toBeUndefined();
    });

    it('resets activeCommentId if deleted comment was active', () => {
      seedComment({ id: 'c1' });
      useCommentStore.setState({ activeCommentId: 'c1' });

      useCommentStore.getState().deleteComment('doc-1', 'c1');

      expect(useCommentStore.getState().activeCommentId).toBeNull();
    });

    it('preserves activeCommentId if a different comment was active', () => {
      seedComment({ id: 'c1' });
      useCommentStore.setState({ activeCommentId: 'c2' });

      useCommentStore.getState().deleteComment('doc-1', 'c1');

      expect(useCommentStore.getState().activeCommentId).toBe('c2');
    });
  });

  // -----------------------------------------------------------------------
  // 5. addReply
  // -----------------------------------------------------------------------

  describe('addReply', () => {
    it('appends a reply with UUID and timestamp', () => {
      seedComment({ id: 'c1' });

      useCommentStore.getState().addReply('doc-1', 'c1', 'A reply', 'agent');

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.replies).toHaveLength(1);
      expect(comment.replies![0].body).toBe('A reply');
      expect(comment.replies![0].author).toBe('agent');
      expect(comment.replies![0].id).toBeTruthy();
      expect(comment.replies![0].timestamp).toBeGreaterThan(0);
    });

    it('appends to existing replies', () => {
      seedComment({
        id: 'c1',
        replies: [{ id: 'r1', body: 'First reply', author: 'agent', timestamp: 1000 }],
      });

      useCommentStore.getState().addReply('doc-1', 'c1', 'Second reply', 'user');

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.replies).toHaveLength(2);
    });

    it('includes activities when provided', () => {
      seedComment({ id: 'c1' });
      const activities: DelegationActivity[] = [
        { label: 'Reading file', status: 'done', timestamp: Date.now() },
      ];

      useCommentStore.getState().addReply('doc-1', 'c1', 'Reply', 'agent', activities);

      const reply = useCommentStore.getState().commentsByDocument['doc-1'][0].replies![0];
      expect(reply.activities).toEqual(activities);
    });
  });

  // -----------------------------------------------------------------------
  // 6. setCommentStatus
  // -----------------------------------------------------------------------

  describe('setCommentStatus', () => {
    it('updates status to delegated', () => {
      seedComment({ id: 'c1', status: 'open' });

      useCommentStore.getState().setCommentStatus('doc-1', 'c1', 'delegated');

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.status).toBe('delegated');
    });

    it('resolving cleans up activities and delegation modes', () => {
      seedComment({ id: 'c1', status: 'done' });
      useCommentStore.setState({
        activitiesByComment: { c1: [{ label: 'test', status: 'done', timestamp: 1 }] },
        delegationModeByComment: { c1: 'delegate' },
      });

      useCommentStore.getState().setCommentStatus('doc-1', 'c1', 'resolved');

      expect(useCommentStore.getState().activitiesByComment['c1']).toBeUndefined();
      expect(useCommentStore.getState().delegationModeByComment['c1']).toBeUndefined();
    });

    it('non-resolved status does not clean up activities', () => {
      seedComment({ id: 'c1', status: 'open' });
      useCommentStore.setState({
        activitiesByComment: { c1: [{ label: 'test', status: 'running', timestamp: 1 }] },
      });

      useCommentStore.getState().setCommentStatus('doc-1', 'c1', 'done');

      expect(useCommentStore.getState().activitiesByComment['c1']).toHaveLength(1);
    });

    it('resolving clears partial reply', () => {
      seedComment({ id: 'c1' });
      appendPartialReply('doc-1', 'c1', 'partial text');

      useCommentStore.getState().setCommentStatus('doc-1', 'c1', 'resolved');

      expect(getPartialReply('doc-1', 'c1')).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // 7. setTaskId / setLinkedConversation
  // -----------------------------------------------------------------------

  describe('setTaskId', () => {
    it('updates taskId on the comment', () => {
      seedComment({ id: 'c1' });

      useCommentStore.getState().setTaskId('doc-1', 'c1', 'task-42');

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.taskId).toBe('task-42');
      expect(comment.updatedAt).toBeGreaterThan(1000);
    });
  });

  describe('setLinkedConversation', () => {
    it('updates linkedConversationId on the comment', () => {
      seedComment({ id: 'c1' });

      useCommentStore.getState().setLinkedConversation('doc-1', 'c1', 'conv-99');

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.linkedConversationId).toBe('conv-99');
      expect(comment.updatedAt).toBeGreaterThan(1000);
    });
  });

  // -----------------------------------------------------------------------
  // 8. Activity management
  // -----------------------------------------------------------------------

  describe('activity management', () => {
    it('addActivity appends to comment activities', () => {
      const activity: DelegationActivity = { label: 'Reading', status: 'running', timestamp: 1 };

      useCommentStore.getState().addActivity('c1', activity);

      expect(useCommentStore.getState().activitiesByComment['c1']).toHaveLength(1);
      expect(useCommentStore.getState().activitiesByComment['c1'][0].label).toBe('Reading');
    });

    it('addActivity appends to existing activities', () => {
      useCommentStore.setState({
        activitiesByComment: { c1: [{ label: 'First', status: 'done', timestamp: 1 }] },
      });

      useCommentStore.getState().addActivity('c1', { label: 'Second', status: 'running', timestamp: 2 });

      expect(useCommentStore.getState().activitiesByComment['c1']).toHaveLength(2);
    });

    it('completeLastActivity marks the last running activity as done', () => {
      useCommentStore.setState({
        activitiesByComment: {
          c1: [
            { label: 'First', status: 'done', timestamp: 1 },
            { label: 'Second', status: 'running', timestamp: 2 },
            { label: 'Third', status: 'running', timestamp: 3 },
          ],
        },
      });

      useCommentStore.getState().completeLastActivity('c1');

      const activities = useCommentStore.getState().activitiesByComment['c1'];
      expect(activities[1].status).toBe('running');
      expect(activities[2].status).toBe('done');
    });

    it('completeLastActivity is no-op when no activities exist', () => {
      const before = useCommentStore.getState();

      useCommentStore.getState().completeLastActivity('nonexistent');

      // Should return same state reference (no-op)
      expect(useCommentStore.getState().activitiesByComment).toEqual(before.activitiesByComment);
    });

    it('completeAllActivities marks all running activities as done', () => {
      useCommentStore.setState({
        activitiesByComment: {
          c1: [
            { label: 'First', status: 'running', timestamp: 1 },
            { label: 'Second', status: 'info', timestamp: 2 },
            { label: 'Third', status: 'running', timestamp: 3 },
          ],
        },
      });

      useCommentStore.getState().completeAllActivities('c1');

      const activities = useCommentStore.getState().activitiesByComment['c1'];
      expect(activities[0].status).toBe('done');
      expect(activities[1].status).toBe('info'); // unchanged
      expect(activities[2].status).toBe('done');
    });

    it('completeAllActivities is no-op when no activities exist', () => {
      useCommentStore.getState().completeAllActivities('nonexistent');

      expect(useCommentStore.getState().activitiesByComment).toEqual({});
    });

    it('clearActivities removes all activities for a comment', () => {
      useCommentStore.setState({
        activitiesByComment: {
          c1: [{ label: 'Test', status: 'done', timestamp: 1 }],
          c2: [{ label: 'Other', status: 'running', timestamp: 2 }],
        },
      });

      useCommentStore.getState().clearActivities('c1');

      expect(useCommentStore.getState().activitiesByComment['c1']).toBeUndefined();
      expect(useCommentStore.getState().activitiesByComment['c2']).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Delegation mode
  // -----------------------------------------------------------------------

  describe('delegation mode', () => {
    it('setDelegationMode sets mode for a comment', () => {
      useCommentStore.getState().setDelegationMode('c1', 'chat');

      expect(useCommentStore.getState().delegationModeByComment['c1']).toBe('chat');
    });

    it('setDelegationMode overwrites existing mode', () => {
      useCommentStore.getState().setDelegationMode('c1', 'chat');
      useCommentStore.getState().setDelegationMode('c1', 'delegate');

      expect(useCommentStore.getState().delegationModeByComment['c1']).toBe('delegate');
    });

    it('clearDelegationMode removes mode for a comment', () => {
      useCommentStore.setState({ delegationModeByComment: { c1: 'chat', c2: 'delegate' } });

      useCommentStore.getState().clearDelegationMode('c1');

      expect(useCommentStore.getState().delegationModeByComment['c1']).toBeUndefined();
      expect(useCommentStore.getState().delegationModeByComment['c2']).toBe('delegate');
    });
  });

  // -----------------------------------------------------------------------
  // 10. Navigation
  // -----------------------------------------------------------------------

  describe('navigation', () => {
    it('setActiveComment sets the active comment ID', () => {
      useCommentStore.getState().setActiveComment('c1');
      expect(useCommentStore.getState().activeCommentId).toBe('c1');
    });

    it('setActiveComment can clear with null', () => {
      useCommentStore.setState({ activeCommentId: 'c1' });
      useCommentStore.getState().setActiveComment(null);
      expect(useCommentStore.getState().activeCommentId).toBeNull();
    });

    it('requestScrollToComment sets scrollToCommentId', () => {
      useCommentStore.getState().requestScrollToComment('c1');
      expect(useCommentStore.getState().scrollToCommentId).toBe('c1');
    });

    it('clearScrollToComment resets scrollToCommentId', () => {
      useCommentStore.setState({ scrollToCommentId: 'c1' });
      useCommentStore.getState().clearScrollToComment();
      expect(useCommentStore.getState().scrollToCommentId).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // 11. updateCommentPositions
  // -----------------------------------------------------------------------

  describe('updateCommentPositions', () => {
    it('updates from/to/anchorText for matching comments', () => {
      seedComment({ id: 'c1', from: 10, to: 20, anchorText: 'old text' });

      useCommentStore.getState().updateCommentPositions('doc-1', [
        { id: 'c1', from: 15, to: 30, anchorText: 'new text' },
      ]);

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.from).toBe(15);
      expect(comment.to).toBe(30);
      expect(comment.anchorText).toBe('new text');
    });

    it('returns unchanged state if no positions differ', () => {
      seedComment({ id: 'c1', from: 10, to: 20, anchorText: 'some text' });
      const before = useCommentStore.getState();

      useCommentStore.getState().updateCommentPositions('doc-1', [
        { id: 'c1', from: 10, to: 20, anchorText: 'some text' },
      ]);

      // commentsByDocument reference should be the same (no unnecessary re-render)
      expect(useCommentStore.getState().commentsByDocument).toBe(before.commentsByDocument);
    });

    it('returns unchanged state for empty comment list', () => {
      const before = useCommentStore.getState();

      useCommentStore.getState().updateCommentPositions('doc-1', [
        { id: 'c1', from: 10, to: 20, anchorText: 'text' },
      ]);

      expect(useCommentStore.getState()).toBe(before);
    });

    it('ignores position updates for unknown comment IDs', () => {
      seedComment({ id: 'c1', from: 10, to: 20, anchorText: 'text' });

      useCommentStore.getState().updateCommentPositions('doc-1', [
        { id: 'unknown', from: 50, to: 60, anchorText: 'nope' },
      ]);

      const comment = useCommentStore.getState().commentsByDocument['doc-1'][0];
      expect(comment.from).toBe(10);
    });
  });

  // -----------------------------------------------------------------------
  // 12. loadComments
  // -----------------------------------------------------------------------

  describe('loadComments', () => {
    it('reads comments from Tauri filesystem', async () => {
      const comments: Comment[] = [
        makeComment({ id: 'c1', status: 'open' }),
      ];
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.readFile.mockResolvedValue(JSON.stringify(comments));

      await useCommentStore.getState().loadComments('doc-1', '/project');

      const loaded = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe('c1');
      expect(mockedTauriApi.pathExists).toHaveBeenCalledWith('/project/.notesage/comments/doc-1.json');
      expect(mockedTauriApi.readFile).toHaveBeenCalledWith('/project/.notesage/comments/doc-1.json');
    });

    it('sets empty array when file does not exist', async () => {
      mockedTauriApi.pathExists.mockResolvedValue(false);

      await useCommentStore.getState().loadComments('doc-1', '/project');

      expect(useCommentStore.getState().commentsByDocument['doc-1']).toEqual([]);
      expect(mockedTauriApi.readFile).not.toHaveBeenCalled();
    });

    it('handles parse error gracefully', async () => {
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.readFile.mockResolvedValue('not valid json {{{');

      await useCommentStore.getState().loadComments('doc-1', '/project');

      expect(useCommentStore.getState().commentsByDocument['doc-1']).toEqual([]);
      expect(toast.error).toHaveBeenCalledWith('Failed to load comments — file may be corrupted');
      expect(log.error).toHaveBeenCalled();
    });

    it('resets delegated status to open when no replies', async () => {
      const comments: Comment[] = [
        makeComment({ id: 'c1', status: 'delegated' }),
      ];
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.readFile.mockResolvedValue(JSON.stringify(comments));

      await useCommentStore.getState().loadComments('doc-1', '/project');

      const loaded = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(loaded[0].status).toBe('open');
    });

    it('resets delegated status to done when replies exist', async () => {
      const comments: Comment[] = [
        makeComment({
          id: 'c1',
          status: 'delegated',
          replies: [{ id: 'r1', body: 'reply', author: 'agent', timestamp: 1 }],
        }),
      ];
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.readFile.mockResolvedValue(JSON.stringify(comments));

      await useCommentStore.getState().loadComments('doc-1', '/project');

      const loaded = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(loaded[0].status).toBe('done');
    });

    it('preserves non-delegated statuses on load', async () => {
      const comments: Comment[] = [
        makeComment({ id: 'c1', status: 'done' }),
        makeComment({ id: 'c2', status: 'resolved' }),
      ];
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.readFile.mockResolvedValue(JSON.stringify(comments));

      await useCommentStore.getState().loadComments('doc-1', '/project');

      const loaded = useCommentStore.getState().commentsByDocument['doc-1'];
      expect(loaded[0].status).toBe('done');
      expect(loaded[1].status).toBe('resolved');
    });

    it('handles readFile error gracefully', async () => {
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.readFile.mockRejectedValue(new Error('Permission denied'));

      await useCommentStore.getState().loadComments('doc-1', '/project');

      expect(useCommentStore.getState().commentsByDocument['doc-1']).toEqual([]);
      expect(log.error).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // 13. saveComments
  // -----------------------------------------------------------------------

  describe('saveComments', () => {
    it('writes comments JSON to the correct path', async () => {
      seedComment({ id: 'c1' });
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.writeFile.mockResolvedValue(undefined);

      await useCommentStore.getState().saveComments('doc-1', '/project');

      expect(mockedTauriApi.writeFile).toHaveBeenCalledWith(
        '/project/.notesage/comments/doc-1.json',
        expect.any(String),
      );
      // Verify the written JSON is parseable and matches
      const writtenJson = mockedTauriApi.writeFile.mock.calls[0][1] as string;
      const parsed = JSON.parse(writtenJson);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].id).toBe('c1');
    });

    it('creates directories if they do not exist', async () => {
      seedComment({ id: 'c1' });
      // First call: comments dir doesn't exist; second call: .notesage dir doesn't exist
      mockedTauriApi.pathExists
        .mockResolvedValueOnce(false)   // comments dir
        .mockResolvedValueOnce(false);  // .notesage dir
      mockedTauriApi.createDirectory.mockResolvedValue(undefined);
      mockedTauriApi.writeFile.mockResolvedValue(undefined);

      await useCommentStore.getState().saveComments('doc-1', '/project');

      expect(mockedTauriApi.createDirectory).toHaveBeenCalledWith('/project/.notesage');
      expect(mockedTauriApi.createDirectory).toHaveBeenCalledWith('/project/.notesage/comments');
      expect(mockedTauriApi.writeFile).toHaveBeenCalled();
    });

    it('only creates comments dir if .notesage already exists', async () => {
      seedComment({ id: 'c1' });
      mockedTauriApi.pathExists
        .mockResolvedValueOnce(false)  // comments dir
        .mockResolvedValueOnce(true);  // .notesage dir exists
      mockedTauriApi.createDirectory.mockResolvedValue(undefined);
      mockedTauriApi.writeFile.mockResolvedValue(undefined);

      await useCommentStore.getState().saveComments('doc-1', '/project');

      expect(mockedTauriApi.createDirectory).toHaveBeenCalledTimes(1);
      expect(mockedTauriApi.createDirectory).toHaveBeenCalledWith('/project/.notesage/comments');
    });

    it('handles write error gracefully', async () => {
      seedComment({ id: 'c1' });
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.writeFile.mockRejectedValue(new Error('Disk full'));

      await useCommentStore.getState().saveComments('doc-1', '/project');

      expect(log.error).toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalled();
    });

    it('saves empty array when document has no comments', async () => {
      useCommentStore.setState({ commentsByDocument: { 'doc-1': [] } });
      mockedTauriApi.pathExists.mockResolvedValue(true);
      mockedTauriApi.writeFile.mockResolvedValue(undefined);

      await useCommentStore.getState().saveComments('doc-1', '/project');

      const writtenJson = mockedTauriApi.writeFile.mock.calls[0][1] as string;
      expect(JSON.parse(writtenJson)).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 14. clearDocument
  // -----------------------------------------------------------------------

  describe('clearDocument', () => {
    it('removes all comment data for a document', () => {
      useCommentStore.setState({
        commentsByDocument: {
          'doc-1': [makeComment({ id: 'c1' }), makeComment({ id: 'c2' })],
          'doc-2': [makeComment({ id: 'c3', documentId: 'doc-2' })],
        },
        activitiesByComment: {
          c1: [{ label: 'Test', status: 'done', timestamp: 1 }],
          c3: [{ label: 'Other', status: 'running', timestamp: 2 }],
        },
        delegationModeByComment: { c1: 'chat', c3: 'delegate' },
      });

      useCommentStore.getState().clearDocument('doc-1');

      const state = useCommentStore.getState();
      expect(state.commentsByDocument['doc-1']).toBeUndefined();
      expect(state.commentsByDocument['doc-2']).toHaveLength(1);
      expect(state.activitiesByComment['c1']).toBeUndefined();
      expect(state.activitiesByComment['c3']).toBeDefined();
      expect(state.delegationModeByComment['c1']).toBeUndefined();
      expect(state.delegationModeByComment['c3']).toBe('delegate');
    });

    it('resets activeCommentId if it belonged to the cleared document', () => {
      useCommentStore.setState({
        commentsByDocument: { 'doc-1': [makeComment({ id: 'c1' })] },
        activeCommentId: 'c1',
      });

      useCommentStore.getState().clearDocument('doc-1');

      expect(useCommentStore.getState().activeCommentId).toBeNull();
    });

    it('preserves activeCommentId if it belongs to another document', () => {
      useCommentStore.setState({
        commentsByDocument: {
          'doc-1': [makeComment({ id: 'c1' })],
          'doc-2': [makeComment({ id: 'c2', documentId: 'doc-2' })],
        },
        activeCommentId: 'c2',
      });

      useCommentStore.getState().clearDocument('doc-1');

      expect(useCommentStore.getState().activeCommentId).toBe('c2');
    });

    it('is a no-op for unknown documents', () => {
      const before = useCommentStore.getState();
      useCommentStore.getState().clearDocument('nonexistent');

      expect(useCommentStore.getState().commentsByDocument).toEqual(before.commentsByDocument);
    });
  });

  // -----------------------------------------------------------------------
  // 15. Partial replies (module-level exports)
  // -----------------------------------------------------------------------

  describe('partial replies', () => {
    it('appendPartialReply accumulates text', () => {
      appendPartialReply('doc-1', 'c1', 'Hello');
      appendPartialReply('doc-1', 'c1', ' World');

      expect(getPartialReply('doc-1', 'c1')).toBe('Hello World');
    });

    it('appendPartialReply increments partialReplyVersion', () => {
      expect(useCommentStore.getState().partialReplyVersion).toBe(0);

      appendPartialReply('doc-1', 'c1', 'chunk');

      expect(useCommentStore.getState().partialReplyVersion).toBe(1);
    });

    it('getPartialReply returns undefined for nonexistent key', () => {
      expect(getPartialReply('doc-1', 'nonexistent')).toBeUndefined();
    });

    it('clearPartialReply removes the partial reply', () => {
      appendPartialReply('doc-1', 'c1', 'text');
      clearPartialReply('doc-1', 'c1');

      expect(getPartialReply('doc-1', 'c1')).toBeUndefined();
    });

    it('clearPartialReply increments partialReplyVersion', () => {
      const versionBefore = useCommentStore.getState().partialReplyVersion;
      clearPartialReply('doc-1', 'c1');

      expect(useCommentStore.getState().partialReplyVersion).toBe(versionBefore + 1);
    });

    it('partial replies are scoped per document+comment', () => {
      appendPartialReply('doc-1', 'c1', 'AAA');
      appendPartialReply('doc-1', 'c2', 'BBB');

      expect(getPartialReply('doc-1', 'c1')).toBe('AAA');
      expect(getPartialReply('doc-1', 'c2')).toBe('BBB');
    });
  });
});
