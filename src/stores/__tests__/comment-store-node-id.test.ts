import { describe, it, expect, beforeEach } from 'vitest';
import { useCommentStore, type Comment } from '../comment-store';

describe('comment-store node ID fields', () => {
  beforeEach(() => {
    useCommentStore.setState({
      commentsByDocument: {},
      activeCommentId: null,
      scrollToCommentId: null,
      activitiesByComment: {},
      delegationModeByComment: {},
      partialReplyVersion: 0,
    });
  });

  it('addComment stores nodeId, nodeOffset, and nodeEndOffset', () => {
    const comment = useCommentStore.getState().addComment({
      documentId: 'test-doc',
      anchorText: 'hello world',
      from: 10,
      to: 21,
      nodeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      nodeOffset: 5,
      nodeEndOffset: 16,
      body: 'Test comment',
      author: 'You',
    });

    expect(comment.nodeId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(comment.nodeOffset).toBe(5);
    expect(comment.nodeEndOffset).toBe(16);
  });

  it('addComment works without nodeId (backward compatibility)', () => {
    const comment = useCommentStore.getState().addComment({
      documentId: 'test-doc',
      anchorText: 'hello',
      from: 1,
      to: 6,
      body: 'Old comment',
      author: 'You',
    });

    expect(comment.nodeId).toBeUndefined();
    expect(comment.nodeOffset).toBeUndefined();
    expect(comment.nodeEndOffset).toBeUndefined();
    // Position-based fields should still work
    expect(comment.from).toBe(1);
    expect(comment.to).toBe(6);
  });

  it('updateCommentPositions preserves existing nodeId when not provided', () => {
    const store = useCommentStore.getState();

    // Add a comment with node ID
    store.addComment({
      documentId: 'doc1',
      anchorText: 'test',
      from: 10,
      to: 14,
      nodeId: 'my-node-id-0000-0000-0000-000000000001',
      nodeOffset: 5,
      nodeEndOffset: 9,
      body: 'test',
      author: 'You',
    });

    const comments = useCommentStore.getState().commentsByDocument['doc1'];
    const commentId = comments[0].id;

    // Update positions without nodeId — should preserve existing
    useCommentStore.getState().updateCommentPositions('doc1', [
      { id: commentId, from: 12, to: 16, anchorText: 'test' },
    ]);

    const updated = useCommentStore.getState().commentsByDocument['doc1'][0];
    expect(updated.from).toBe(12);
    expect(updated.to).toBe(16);
    // nodeId should be preserved from original
    expect(updated.nodeId).toBe('my-node-id-0000-0000-0000-000000000001');
    expect(updated.nodeOffset).toBe(5); // preserved
  });

  it('updateCommentPositions updates nodeId when provided', () => {
    const store = useCommentStore.getState();

    store.addComment({
      documentId: 'doc1',
      anchorText: 'test',
      from: 10,
      to: 14,
      nodeId: 'old-node-0000-0000-0000-000000000001',
      nodeOffset: 5,
      body: 'test',
      author: 'You',
    });

    const comments = useCommentStore.getState().commentsByDocument['doc1'];
    const commentId = comments[0].id;

    // Update with new nodeId
    useCommentStore.getState().updateCommentPositions('doc1', [
      {
        id: commentId,
        from: 20,
        to: 24,
        anchorText: 'test',
        nodeId: 'new-node-0000-0000-0000-000000000002',
        nodeOffset: 3,
        nodeEndOffset: 7,
      },
    ]);

    const updated = useCommentStore.getState().commentsByDocument['doc1'][0];
    expect(updated.nodeId).toBe('new-node-0000-0000-0000-000000000002');
    expect(updated.nodeOffset).toBe(3);
    expect(updated.nodeEndOffset).toBe(7);
  });

  it('existing comments without nodeId are valid (backward compat)', () => {
    // Simulate loading a comment file from disk without nodeId fields
    const legacyComment: Comment = {
      id: 'legacy-1',
      documentId: 'doc1',
      anchorText: 'old text',
      from: 5,
      to: 13,
      body: 'A legacy comment',
      author: 'User',
      createdAt: Date.now() - 100000,
      updatedAt: Date.now() - 100000,
    };

    useCommentStore.setState({
      commentsByDocument: { doc1: [legacyComment] },
    });

    const comments = useCommentStore.getState().commentsByDocument['doc1'];
    expect(comments).toHaveLength(1);
    expect(comments[0].nodeId).toBeUndefined();
    expect(comments[0].from).toBe(5);
    expect(comments[0].to).toBe(13);
  });
});
