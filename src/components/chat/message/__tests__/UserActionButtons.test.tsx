// @vitest-environment jsdom

// UserActionButtons observes its bubble via ResizeObserver to decide whether to
// collapse into a ⋯ menu — provide a no-op shim so jsdom doesn't crash. In jsdom
// offsetWidth is 0, so the overflow check early-returns and the inline (non-collapsed)
// layout is exercised.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof globalThis.ResizeObserver;
}

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/component-harness';
import { UserActionButtons } from '../UserActionButtons';

describe('UserActionButtons', () => {
  it('renders edit, resend, branch and copy actions for a user message', () => {
    render(
      <UserActionButtons
        isUser={true}
        onEdit={() => {}}
        onResend={() => {}}
        onBranch={() => {}}
        onCopy={() => {}}
        copied={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'Edit message' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resend message' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Branch from here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeTruthy();
  });

  it('omits edit and resend actions when their handlers are absent', () => {
    render(
      <UserActionButtons
        isUser={true}
        onBranch={() => {}}
        onCopy={() => {}}
        copied={false}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend message' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Branch from here' })).toBeTruthy();
  });

  it('reflects the copied state in the copy button label', () => {
    render(
      <UserActionButtons isUser={true} onCopy={() => {}} copied={true} />,
    );
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy message' })).toBeNull();
  });

  it('invokes handlers when the corresponding action is clicked', () => {
    const onEdit = vi.fn();
    const onCopy = vi.fn();
    render(
      <UserActionButtons
        isUser={true}
        onEdit={onEdit}
        onCopy={onCopy}
        copied={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy message' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('renders only branch and copy for an assistant message', () => {
    render(
      <UserActionButtons
        isUser={false}
        onEdit={() => {}}
        onResend={() => {}}
        onBranch={() => {}}
        onCopy={() => {}}
        copied={false}
      />,
    );
    // Assistant path never renders edit/resend even if handlers are passed
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resend message' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Branch from here' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy message' })).toBeTruthy();
  });
});
