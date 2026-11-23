// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { toast } from 'sonner';
import { DialogErrorBoundary } from '@/components/DialogErrorBoundary';

/**
 * Dialogs mounted at the App root sit beside the workspace, outside its
 * boundary: a render error in one used to unmount the whole tree, editor
 * included (audit 2026-11-22 §10).
 */

let shouldThrow = true;
function BrokenDialog() {
  if (shouldThrow) throw new Error('lazy chunk failed to load');
  return <div>dialog content</div>;
}

describe('DialogErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = true;
    vi.mocked(toast.error).mockClear();
    // React logs the caught error; keep the test output readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('a crashing dialog does not take its siblings with it', () => {
    render(
      <div>
        <div>the editor</div>
        <DialogErrorBoundary name="Settings">
          <BrokenDialog />
        </DialogErrorBoundary>
      </div>,
    );

    expect(screen.getByText('the editor')).toBeTruthy();
    expect(screen.queryByText('dialog content')).toBeNull();
  });

  it('reports the crash in a toast that names the dialog and offers a retry', () => {
    render(
      <DialogErrorBoundary name="Settings">
        <BrokenDialog />
      </DialogErrorBoundary>,
    );

    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(toast.error).mock.calls[0];
    expect(String(message)).toContain('Settings');
    expect(options).toMatchObject({ description: 'lazy chunk failed to load' });

    // "Try again" clears the boundary and renders the dialog again.
    shouldThrow = false;
    const action = (options as unknown as { action: { onClick: () => void } }).action;
    act(() => action.onClick());
    expect(screen.getByText('dialog content')).toBeTruthy();
  });
});
