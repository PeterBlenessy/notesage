// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const getLocalServerLog = vi.fn();
vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    get getLocalServerLog() {
      return getLocalServerLog;
    },
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));

import { ServerLogDialog } from '../ServerLogDialog';

describe('ServerLogDialog', () => {
  beforeEach(() => {
    getLocalServerLog.mockReset();
    toastError.mockReset();
  });

  it('reads the log only when opened, not on mount', async () => {
    // The panel this lives in renders on every Settings visit; fetching eagerly
    // would read the log for users who never ask for it.
    getLocalServerLog.mockResolvedValue(['line one']);
    render(<ServerLogDialog />);
    expect(getLocalServerLog).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /server log/i }));
    await waitFor(() => expect(getLocalServerLog).toHaveBeenCalledTimes(1));
  });

  it('shows the engine output it was opened to reveal', async () => {
    getLocalServerLog.mockResolvedValue([
      'srv update_slots: the prompt exceeds the context size',
      'slot released: kv cache is full',
    ]);
    render(<ServerLogDialog />);
    await userEvent.click(screen.getByRole('button', { name: /server log/i }));

    await waitFor(() =>
      expect(screen.getByText(/the prompt exceeds the context size/)).toBeTruthy(),
    );
    expect(screen.getByText(/kv cache is full/)).toBeTruthy();
  });

  it('explains an empty log rather than showing a blank panel', async () => {
    getLocalServerLog.mockResolvedValue([]);
    render(<ServerLogDialog />);
    await userEvent.click(screen.getByRole('button', { name: /server log/i }));

    await waitFor(() => expect(screen.getByText(/nothing logged yet/i)).toBeTruthy());
  });

  it('surfaces a read failure instead of rejecting unhandled', async () => {
    // A diagnostic aid must never be the thing that breaks the settings panel.
    getLocalServerLog.mockRejectedValue(new Error('backend gone'));
    render(<ServerLogDialog />);
    await userEvent.click(screen.getByRole('button', { name: /server log/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
