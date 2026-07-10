// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { CrossProjectScopePill } from '../CrossProjectScopePill';

describe('CrossProjectScopePill', () => {
  it('renders the destructive cross-project scope warning affordance', () => {
    renderWithProviders(<CrossProjectScopePill />);

    const button = screen.getByRole('button', { name: /Cross-project mode exposes all workspace folders/ });
    expect(button).toBeTruthy();
    // Visible label + the security-relevant explanatory title.
    expect(screen.getByText('Cross-project scope')).toBeTruthy();
    expect(button.getAttribute('title')).toMatch(/exposes all workspace folders to the agent/);
  });

  it('dispatches the open-settings event targeting the AI tab on click', () => {
    const handler = vi.fn();
    window.addEventListener('notesage:open-settings', handler as EventListener);

    renderWithProviders(<CrossProjectScopePill />);
    fireEvent.click(screen.getByRole('button'));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent<{ tab: string }>;
    expect(event.detail.tab).toBe('ai');

    window.removeEventListener('notesage:open-settings', handler as EventListener);
  });
});
