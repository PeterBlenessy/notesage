// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { CommentList } from '../CommentListPopover';
import type { Comment } from '@/stores/comment-store';

const comment: Comment = {
  id: 'c1',
  documentId: 'd',
  anchorText: 'anchor snippet',
  from: 0,
  to: 0,
  body: 'first comment body',
  author: 'u',
  createdAt: 0,
  updatedAt: 0,
};

describe('CommentList rows', () => {
  it('renders the delegate button as a sibling of the row button, not inside it', () => {
    const onSelect = vi.fn();
    const onDelegate = vi.fn();
    render(
      <CommentList
        comments={[comment]}
        onSelectComment={onSelect}
        onDelegateComment={onDelegate}
        canDelegate
      />,
    );

    const delegate = screen.getByRole('button', { name: 'Delegate to AI agent' });
    // A <button> nested in a <button> is invalid HTML and is flattened by AT.
    expect(delegate.parentElement?.closest('button')).toBeNull();
    expect(delegate.closest('[role="listitem"]')).not.toBeNull();

    fireEvent.click(delegate);
    expect(onDelegate).toHaveBeenCalledWith(comment);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('first comment body'));
    expect(onSelect).toHaveBeenCalledWith(comment);
  });
});
