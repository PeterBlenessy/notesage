// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { TabBar } from '@/components/tabs/TabBar';
import { useEditorStore } from '@/stores/editor-store';
import { createMockTab } from '@/test/mock-data';

const ACCENT_TOKEN = 'var(--color-accent-primary)';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  useEditorStore.setState({ tabs: [], activeTabId: null, pendingCloseTabId: null });
});

describe('TabBar — accent wiring (UI Refresh #6)', () => {
  it('dirty dot uses --color-accent-primary, not raw --color-primary', () => {
    const tab = createMockTab({ id: 'tab-1', fileName: 'dirty.md', isDirty: true });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const button = screen.getByText('dirty.md').closest('button')!;
    const spans = Array.from(button.querySelectorAll('span'));

    // Dirty dot is a tiny round span; must reach the accent token so it pops with
    // the user's chosen accent. Identify by the size + shape, then assert the colour token.
    const dirtyDot = spans.find(
      (s) => s.className.includes('rounded-full') && s.className.includes('w-1.5') && s.className.includes('h-1.5')
    );
    expect(dirtyDot).toBeTruthy();
    expect(dirtyDot!.className).toContain(`bg-[${ACCENT_TOKEN}]`);
  });
});
