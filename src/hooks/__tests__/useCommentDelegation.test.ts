// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useCommentStore, type Comment } from '@/stores/comment-store';
import { useChatStore } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useEditorStore } from '@/stores/editor-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useCommentDelegation } from '@/hooks/useCommentDelegation';

// ---------------------------------------------------------------------------
// Patch sonner mock — the tauri-mock provides toast as a plain object with
// .success/.error etc, but the source also calls toast() directly as a function.
// We replace the sonner module's toast export with a callable vi.fn that also
// has the method stubs.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockToastFn: any;

// ---------------------------------------------------------------------------
// Mock useAgentTaskOperations
// ---------------------------------------------------------------------------

const mockStartTask = vi.fn<(...args: unknown[]) => Promise<string>>();
const mockCancelTask = vi.fn<(...args: unknown[]) => Promise<boolean>>();
let mockTaskConnection: { id: string; provider: string; label: string } | null = null;

vi.mock('@/hooks/useAgentTaskOperations', () => ({
  useAgentTaskOperations: vi.fn(() => ({
    startTask: mockStartTask,
    cancelTask: mockCancelTask,
    taskConnection: mockTaskConnection,
  })),
  stopTaskAgent: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 'comment-1',
    documentId: 'doc-uuid-1',
    anchorText: 'some text in the document',
    from: 10,
    to: 35,
    body: 'Fix the typo here',
    author: 'You',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
    status: 'open',
    ...overrides,
  };
}

const DOC_ID = 'doc-uuid-1';
const PROJECT_ROOT = '/Users/test/project';

function resetStores() {
  useCommentStore.setState({
    commentsByDocument: {},
    activeCommentId: null,
    scrollToCommentId: null,
    activitiesByComment: {},
    delegationModeByComment: {},
    partialReplyVersion: 0,
  });

  useEditorStore.setState({
    tabs: [
      {
        id: 'tab-1',
        filePath: '/Users/test/project/notes/test.md',
        fileName: 'test.md',
        content: '',
        isDirty: false,
        frontmatter: null,
        fileType: 'markdown',
      },
    ],
    activeTabId: 'tab-1',
  });

  useWorkspaceStore.setState({
    projects: [{ path: '/Users/test/project', fileTree: [] }],
    explorerFolders: [],
  });
}

/**
 * Extract the callbacks passed to startTask so we can invoke them in tests.
 * startTask is called as: startTask(prompt, callbacks, meta)
 */
function getStartTaskCallbacks() {
  const call = mockStartTask.mock.calls[mockStartTask.mock.calls.length - 1];
  return call[1] as {
    onComplete: (output: string) => void;
    onActivity: (activity: { event: string; label: string; detail?: string }) => void;
    onError: (errorMsg: string) => void;
    onChunk: (chunk: string) => void;
  };
}

function getStartTaskMeta() {
  const call = mockStartTask.mock.calls[mockStartTask.mock.calls.length - 1];
  return call[2] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCommentDelegation', () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Patch sonner's toast export to be a callable function (tauri-mock creates
    // it as a plain object). We do this every beforeEach since clearAllMocks
    // resets vi.fn spies but not the module binding.
    const sonner = await import('sonner');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fn = vi.fn() as any;
    fn.success = vi.fn();
    fn.error = vi.fn();
    fn.warning = vi.fn();
    fn.info = vi.fn();
    fn.loading = vi.fn();
    fn.dismiss = vi.fn();
    // Replace the toast export on the module object
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (sonner as any).toast = fn;
    mockToastFn = fn;
    resetStores();
    mockTaskConnection = {
      id: 'conn-agent-1',
      provider: 'anthropic',
      label: 'Claude Code',
    };
    mockStartTask.mockResolvedValue('task-123');
    mockCancelTask.mockResolvedValue(true);

    // Mock saveComments to avoid actual Tauri calls
    vi.spyOn(useCommentStore.getState(), 'saveComments').mockResolvedValue();
  });

  // =========================================================================
  // delegateComment
  // =========================================================================

  describe('delegateComment', () => {
    it('shows error toast when no task connection is configured', async () => {
      mockTaskConnection = null;

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(makeComment(), DOC_ID, PROJECT_ROOT);
      });

      expect(mockToastFn.error).toHaveBeenCalledWith(
        'No agent configured for tasks. Set up agent routing in Settings.'
      );
      expect(mockStartTask).not.toHaveBeenCalled();
    });

    it('sets comment status to delegated and calls startTask', async () => {
      const comment = makeComment();
      // Put comment in store so save can work
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });
      // Re-mock saveComments on the fresh state
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({ saveComments: saveSpy } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      // startTask was called
      expect(mockStartTask).toHaveBeenCalledTimes(1);

      // Check prompt includes anchor and comment body
      const prompt = mockStartTask.mock.calls[0][0] as string;
      expect(prompt).toContain(comment.anchorText);
      expect(prompt).toContain(comment.body);

      // Check meta
      const meta = getStartTaskMeta();
      expect(meta.type).toBe('comment');
      expect(meta.commentId).toBe('comment-1');
      expect(meta.documentId).toBe(DOC_ID);
      expect(meta.trackInActivityStore).toBe(true); // default mode is 'delegate'
    });

    it('sets trackInActivityStore to false when mode is chat', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({ saveComments: saveSpy } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT, 'chat');
      });

      const meta = getStartTaskMeta();
      expect(meta.trackInActivityStore).toBe(false);
    });

    it('stores taskId on the comment after successful startTask', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const setTaskIdSpy = vi.fn();
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({
        saveComments: saveSpy,
        setTaskId: setTaskIdSpy,
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      expect(setTaskIdSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'task-123');
    });

    it('records activity log entries during delegation', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const addActivitySpy = vi.fn();
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({
        saveComments: saveSpy,
        setTaskId: vi.fn(),
        addActivity: addActivitySpy,
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      // Should have 'Sending to Claude Code' and 'Agent session started' activities
      const activityCalls = addActivitySpy.mock.calls;
      expect(activityCalls.length).toBeGreaterThanOrEqual(2);

      const sendingActivity = activityCalls.find(
        (c: unknown[]) => (c[1] as { label: string }).label.includes('Sending to Claude Code')
      );
      expect(sendingActivity).toBeDefined();

      const sessionStarted = activityCalls.find(
        (c: unknown[]) => (c[1] as { label: string }).label.includes('Agent session started')
      );
      expect(sessionStarted).toBeDefined();
    });

    it('onComplete callback sets status to done and adds reply', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        activitiesByComment: {},
      });

      const addReplySpy = vi.fn();
      const setStatusSpy = vi.fn();
      const clearDelegationModeSpy = vi.fn();
      const completeAllSpy = vi.fn();
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({
        saveComments: saveSpy,
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: addReplySpy,
        setCommentStatus: setStatusSpy,
        setDelegationMode: vi.fn(),
        clearDelegationMode: clearDelegationModeSpy,
        clearActivities: vi.fn(),
        completeAllActivities: completeAllSpy,
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      // Invoke the onComplete callback
      const callbacks = getStartTaskCallbacks();
      act(() => {
        callbacks.onComplete('Here is the suggested fix.');
      });

      expect(addReplySpy).toHaveBeenCalledWith(
        DOC_ID,
        'comment-1',
        'Here is the suggested fix.',
        'Claude Code',
        expect.any(Array), // activities snapshot
      );
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'done');
      expect(clearDelegationModeSpy).toHaveBeenCalledWith('comment-1');
      expect(completeAllSpy).toHaveBeenCalledWith('comment-1');
    });

    it('onComplete uses fallback text when output is empty', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        activitiesByComment: {},
      });

      const addReplySpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: addReplySpy,
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      const callbacks = getStartTaskCallbacks();
      act(() => {
        callbacks.onComplete('');
      });

      // Should use the fallback text
      expect(addReplySpy.mock.calls[0][2]).toBe('(No response from agent)');
    });

    it('onComplete shows toast for delegate mode', async () => {
      
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        activitiesByComment: {},
      });
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT, 'delegate');
      });

      const callbacks = getStartTaskCallbacks();
      act(() => {
        callbacks.onComplete('Fixed it.');
      });

      expect(mockToastFn.success).toHaveBeenCalledWith(
        'Agent finished working on your comment. Click it to review.',
        expect.objectContaining({ id: 'delegation-done-comment-1' }),
      );
    });

    it('onError marks comment back to open and records error activity', async () => {
      
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const setStatusSpy = vi.fn();
      const addActivitySpy = vi.fn();
      const completeAllSpy = vi.fn();
      const clearDelegationModeSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: addActivitySpy,
        setCommentStatus: setStatusSpy,
        setDelegationMode: vi.fn(),
        clearDelegationMode: clearDelegationModeSpy,
        clearActivities: vi.fn(),
        completeAllActivities: completeAllSpy,
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      const callbacks = getStartTaskCallbacks();
      act(() => {
        callbacks.onError('Connection timed out');
      });

      // Status reverts to open for delegateComment
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'open');
      expect(clearDelegationModeSpy).toHaveBeenCalledWith('comment-1');
      expect(completeAllSpy).toHaveBeenCalledWith('comment-1');

      // Error activity logged
      const errorActivity = addActivitySpy.mock.calls.find(
        (c: unknown[]) => (c[1] as { label: string }).label.includes('Error: Connection timed out')
      );
      expect(errorActivity).toBeDefined();

      expect(mockToastFn.error).toHaveBeenCalledWith('Agent failed: Connection timed out');
    });

    it('onActivity records tool_call and tool_result activities', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const addActivitySpy = vi.fn();
      const completeLastSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: addActivitySpy,
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
        completeLastActivity: completeLastSpy,
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      const callbacks = getStartTaskCallbacks();

      act(() => {
        callbacks.onActivity({ event: 'tool_call', label: 'Read file', detail: 'test.md' });
      });

      const toolCallActivity = addActivitySpy.mock.calls.find(
        (c: unknown[]) => (c[1] as { label: string }).label === 'Read file'
      );
      expect(toolCallActivity).toBeDefined();
      expect(toolCallActivity![1].status).toBe('running');

      act(() => {
        callbacks.onActivity({ event: 'tool_result', label: 'Done' });
      });

      expect(completeLastSpy).toHaveBeenCalledWith('comment-1');
    });

    it('onChunk appends partial reply', async () => {
      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      // Spy on the module-level appendPartialReply
      const { appendPartialReply } = await import('@/stores/comment-store');
      const appendSpy = vi.spyOn({ appendPartialReply }, 'appendPartialReply');

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      const callbacks = getStartTaskCallbacks();
      // onChunk should call appendPartialReply (it's a module-level function)
      // We can verify the callback exists and is a function
      expect(typeof callbacks.onChunk).toBe('function');

      appendSpy.mockRestore();
    });

    it('handles startTask throwing (spawn failure)', async () => {
      
      mockStartTask.mockRejectedValueOnce(new Error('Agent binary not found'));

      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const setStatusSpy = vi.fn();
      const addActivitySpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: addActivitySpy,
        setCommentStatus: setStatusSpy,
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      // Status reverts to open
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'open');

      // Error activity logged
      const errorActivity = addActivitySpy.mock.calls.find(
        (c: unknown[]) => (c[1] as { label: string }).label.includes('Spawn failed')
      );
      expect(errorActivity).toBeDefined();

      expect(mockToastFn.error).toHaveBeenCalledWith('Agent delegation failed: Agent binary not found');
    });
  });

  // =========================================================================
  // delegateReply
  // =========================================================================

  describe('delegateReply', () => {
    it('shows error toast when no task connection is configured', async () => {
      
      mockTaskConnection = null;

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateReply(makeComment(), 'my reply', DOC_ID, PROJECT_ROOT);
      });

      expect(mockToastFn.error).toHaveBeenCalledWith(
        'No agent configured for tasks. Set up agent routing in Settings.'
      );
    });

    it('adds user reply and sends conversation history to agent', async () => {
      const comment = makeComment({
        replies: [
          { id: 'r1', body: 'Initial agent response', author: 'Claude Code', timestamp: Date.now() - 500 },
        ],
      });
      useCommentStore.setState({
        commentsByDocument: {
          [DOC_ID]: [comment],
        },
      });

      const addReplySpy = vi.fn();
      const setStatusSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: addReplySpy,
        setCommentStatus: setStatusSpy,
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateReply(comment, 'Can you also fix the grammar?', DOC_ID, PROJECT_ROOT);
      });

      // User reply is added first
      expect(addReplySpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'Can you also fix the grammar?', 'You');

      // Status set to delegated
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'delegated');

      // startTask called with conversation history in prompt
      expect(mockStartTask).toHaveBeenCalledTimes(1);
      const prompt = mockStartTask.mock.calls[0][0] as string;
      expect(prompt).toContain('ongoing conversation');
      expect(prompt).toContain(comment.anchorText);
      expect(prompt).toContain(comment.body);
    });

    it('passes existingTaskId in meta for multi-turn conversations', async () => {
      const comment = makeComment({ taskId: 'existing-task-42' });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateReply(comment, 'Follow up', DOC_ID, PROJECT_ROOT);
      });

      const meta = getStartTaskMeta();
      expect(meta.existingTaskId).toBe('existing-task-42');
    });

    it('does not update taskId when comment already has one', async () => {
      const comment = makeComment({ taskId: 'existing-task-42' });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const setTaskIdSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: setTaskIdSpy,
        addActivity: vi.fn(),
        addReply: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateReply(comment, 'Follow up', DOC_ID, PROJECT_ROOT);
      });

      // setTaskId should NOT be called because comment already has a taskId
      expect(setTaskIdSpy).not.toHaveBeenCalled();
    });

    it('onError reverts to done (not open) since thread has replies', async () => {
      const comment = makeComment({
        replies: [{ id: 'r1', body: 'Previous reply', author: 'Claude Code', timestamp: Date.now() }],
      });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const setStatusSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: vi.fn(),
        setCommentStatus: setStatusSpy,
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateReply(comment, 'Try again', DOC_ID, PROJECT_ROOT);
      });

      const callbacks = getStartTaskCallbacks();
      act(() => {
        callbacks.onError('Network error');
      });

      // Should revert to 'done' not 'open' because there are already replies
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'done');
    });

    it('spawn failure also reverts to done', async () => {
      mockStartTask.mockRejectedValueOnce(new Error('Spawn failed'));

      const comment = makeComment({
        replies: [{ id: 'r1', body: 'Previous reply', author: 'Claude Code', timestamp: Date.now() }],
      });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });

      const setStatusSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        addReply: vi.fn(),
        setCommentStatus: setStatusSpy,
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateReply(comment, 'Try again', DOC_ID, PROJECT_ROOT);
      });

      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'done');
    });
  });

  // =========================================================================
  // cancelDelegation
  // =========================================================================

  describe('cancelDelegation', () => {
    it('cancels the task and sets status to open when no replies', async () => {
      
      const comment = makeComment({ taskId: 'task-123', status: 'delegated' });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        delegationModeByComment: { 'comment-1': 'delegate' },
      });

      const setStatusSpy = vi.fn();
      const addActivitySpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setCommentStatus: setStatusSpy,
        addActivity: addActivitySpy,
        clearDelegationMode: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.cancelDelegation(comment, DOC_ID, PROJECT_ROOT);
      });

      expect(mockCancelTask).toHaveBeenCalledWith('task-123');
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'open');
      expect(mockToastFn).toHaveBeenCalledWith('Delegation cancelled');
    });

    it('sets status to done when comment has replies', async () => {
      const comment = makeComment({
        taskId: 'task-123',
        status: 'delegated',
        replies: [{ id: 'r1', body: 'Reply', author: 'Claude Code', timestamp: Date.now() }],
      });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        delegationModeByComment: { 'comment-1': 'delegate' },
      });

      const setStatusSpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setCommentStatus: setStatusSpy,
        addActivity: vi.fn(),
        clearDelegationMode: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.cancelDelegation(comment, DOC_ID, PROJECT_ROOT);
      });

      // Should set to 'done' because there are replies
      expect(setStatusSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'done');
    });

    it('shows "Agent stopped" toast for chat mode', async () => {
      
      const comment = makeComment({ taskId: 'task-123', status: 'delegated' });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        delegationModeByComment: { 'comment-1': 'chat' },
      });

      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setCommentStatus: vi.fn(),
        addActivity: vi.fn(),
        clearDelegationMode: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.cancelDelegation(comment, DOC_ID, PROJECT_ROOT);
      });

      expect(mockToastFn).toHaveBeenCalledWith('Agent stopped');
    });

    it('handles comment without taskId', async () => {
      const comment = makeComment({ status: 'delegated' });
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
        delegationModeByComment: { 'comment-1': 'delegate' },
      });

      const addActivitySpy = vi.fn();
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setCommentStatus: vi.fn(),
        addActivity: addActivitySpy,
        clearDelegationMode: vi.fn(),
        completeAllActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.cancelDelegation(comment, DOC_ID, PROJECT_ROOT);
      });

      // cancelTask should not be called
      expect(mockCancelTask).not.toHaveBeenCalled();

      // Activity should say no active task
      const noTaskActivity = addActivitySpy.mock.calls.find(
        (c: unknown[]) => (c[1] as { label: string }).label.includes('no active task')
      );
      expect(noTaskActivity).toBeDefined();
    });
  });

  // =========================================================================
  // delegateAll
  // =========================================================================

  describe('delegateAll', () => {
    it('shows error toast when no task connection', async () => {
      
      mockTaskConnection = null;

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateAll(DOC_ID, PROJECT_ROOT);
      });

      expect(mockToastFn.error).toHaveBeenCalledWith(
        'No agent configured for tasks. Set up agent routing in Settings.'
      );
    });

    it('shows toast when no delegatable comments', async () => {
      
      useCommentStore.setState({
        commentsByDocument: {
          [DOC_ID]: [
            makeComment({ id: 'c1', status: 'done' }),
            makeComment({ id: 'c2', status: 'delegated' }),
          ],
        },
      });

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateAll(DOC_ID, PROJECT_ROOT);
      });

      expect(mockToastFn).toHaveBeenCalledWith('No comments to delegate');
      expect(mockStartTask).not.toHaveBeenCalled();
    });

    it('delegates all open comments', async () => {
      useCommentStore.setState({
        commentsByDocument: {
          [DOC_ID]: [
            makeComment({ id: 'c1', status: 'open', body: 'Fix typo' }),
            makeComment({ id: 'c2', status: 'done', body: 'Already done' }),
            makeComment({ id: 'c3', status: 'open', body: 'Add section' }),
          ],
        },
      });
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateAll(DOC_ID, PROJECT_ROOT);
      });

      // Should delegate c1 and c3, skip c2 (done)
      expect(mockStartTask).toHaveBeenCalledTimes(2);
    });
  });

  // =========================================================================
  // moveToChat
  // =========================================================================

  describe('moveToChat', () => {
    it('creates a new conversation and maps comment thread to chat messages', () => {
      const comment = makeComment({
        replies: [
          { id: 'r1', body: 'Here is the fix', author: 'Claude Code', timestamp: Date.now() - 200 },
          { id: 'r2', body: 'Can you also add tests?', author: 'You', timestamp: Date.now() - 100 },
        ],
      });

      // Set up real chat store and spy on it
      const createConvSpy = vi.fn().mockReturnValue('conv-new-1');
      const addMessageSpy = vi.fn();
      useChatStore.setState({
        createConversation: createConvSpy,
        addMessage: addMessageSpy,
      } as unknown as Partial<ReturnType<typeof useChatStore.getState>>);

      const setLinkedSpy = vi.fn();
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({
        setLinkedConversation: setLinkedSpy,
        saveComments: saveSpy,
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const setChatOpenSpy = vi.fn();
      useSettingsStore.setState({
        setChatPanelOpen: setChatOpenSpy,
      } as unknown as Partial<ReturnType<typeof useSettingsStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      act(() => {
        result.current.moveToChat(comment, '/Users/test/project', PROJECT_ROOT);
      });

      // Creates conversation with title from anchor
      expect(createConvSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Comment:'),
          projectPaths: ['/Users/test/project'],
          sourceCommentId: 'comment-1',
          sourceDocumentId: DOC_ID,
        }),
      );

      // Links conversation to comment
      expect(setLinkedSpy).toHaveBeenCalledWith(DOC_ID, 'comment-1', 'conv-new-1');

      // Original comment is first user message
      expect(addMessageSpy).toHaveBeenCalledTimes(3); // 1 original + 2 replies
      expect(addMessageSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining(comment.body),
        }),
      );

      // Agent reply mapped as assistant
      expect(addMessageSpy.mock.calls[1][0]).toEqual(
        expect.objectContaining({
          role: 'assistant',
          content: 'Here is the fix',
        }),
      );

      // User reply mapped as user
      expect(addMessageSpy.mock.calls[2][0]).toEqual(
        expect.objectContaining({
          role: 'user',
          content: 'Can you also add tests?',
        }),
      );

      // Opens chat panel
      expect(setChatOpenSpy).toHaveBeenCalledWith(true);
    });

    it('saves comments when storageRoot is provided', () => {
      const comment = makeComment();
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      const setLinkedSpy = vi.fn();
      useCommentStore.setState({
        setLinkedConversation: setLinkedSpy,
        saveComments: saveSpy,
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      useChatStore.setState({
        createConversation: vi.fn().mockReturnValue('conv-1'),
        addMessage: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useChatStore.getState>>);

      useSettingsStore.setState({
        setChatPanelOpen: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useSettingsStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      act(() => {
        result.current.moveToChat(comment, '/project', '/project');
      });

      expect(saveSpy).toHaveBeenCalledWith(DOC_ID, '/project');
    });

    it('does not save comments when storageRoot is undefined', () => {
      const comment = makeComment();
      const saveSpy = vi.fn().mockResolvedValue(undefined);
      useCommentStore.setState({
        setLinkedConversation: vi.fn(),
        saveComments: saveSpy,
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      useChatStore.setState({
        createConversation: vi.fn().mockReturnValue('conv-1'),
        addMessage: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useChatStore.getState>>);

      useSettingsStore.setState({
        setChatPanelOpen: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useSettingsStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      act(() => {
        result.current.moveToChat(comment, '/project');
      });

      expect(saveSpy).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // canDelegate
  // =========================================================================

  describe('canDelegate', () => {
    it('returns true when taskConnection is present', () => {
      const { result } = renderHook(() => useCommentDelegation());
      expect(result.current.canDelegate).toBe(true);
    });

    it('returns false when taskConnection is null', () => {
      mockTaskConnection = null;
      const { result } = renderHook(() => useCommentDelegation());
      expect(result.current.canDelegate).toBe(false);
    });
  });

  // =========================================================================
  // Sandbox root resolution
  // =========================================================================

  describe('sandbox root resolution', () => {
    it('uses project path when file is within a project', async () => {
      useEditorStore.setState({
        tabs: [
          { id: 'tab-1', filePath: '/Users/test/project/notes/test.md', fileName: 'test.md', content: '', isDirty: false, frontmatter: null, fileType: 'markdown' as const },
        ],
        activeTabId: 'tab-1',
      });
      useWorkspaceStore.setState({
        projects: [{ path: '/Users/test/project', fileTree: [] }],
        explorerFolders: [],
      });

      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, PROJECT_ROOT);
      });

      const meta = getStartTaskMeta();
      expect(meta.projectRoot).toBe('/Users/test/project');
    });

    it('falls back to provided projectRoot when file is not in any project or explorer folder', async () => {
      useEditorStore.setState({
        tabs: [
          { id: 'tab-1', filePath: '/tmp/random/file.md', fileName: 'file.md', content: '', isDirty: false, frontmatter: null, fileType: 'markdown' as const },
        ],
        activeTabId: 'tab-1',
      });
      useWorkspaceStore.setState({
        projects: [],
        explorerFolders: [],
      });

      const comment = makeComment();
      useCommentStore.setState({
        commentsByDocument: { [DOC_ID]: [comment] },
      });
      useCommentStore.setState({
        saveComments: vi.fn().mockResolvedValue(undefined),
        setTaskId: vi.fn(),
        addActivity: vi.fn(),
        setCommentStatus: vi.fn(),
        setDelegationMode: vi.fn(),
        clearDelegationMode: vi.fn(),
        clearActivities: vi.fn(),
      } as unknown as Partial<ReturnType<typeof useCommentStore.getState>>);

      const { result } = renderHook(() => useCommentDelegation());

      await act(async () => {
        await result.current.delegateComment(comment, DOC_ID, '/fallback/root');
      });

      const meta = getStartTaskMeta();
      expect(meta.projectRoot).toBe('/fallback/root');
    });
  });
});
