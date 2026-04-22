// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/component-harness';
import { TabBar } from '@/components/tabs/TabBar';
import { useEditorStore } from '@/stores/editor-store';
import { createMockTab } from '@/test/mock-data';

beforeEach(() => {
  // jsdom doesn't implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();

  useEditorStore.setState({
    tabs: [],
    activeTabId: null,
    pendingCloseTabId: null,
  });
});

describe('TabBar', () => {
  it('returns null when no tabs are open', () => {
    const { container } = renderWithProviders(<TabBar />);
    expect(container.innerHTML).toBe('');
  });

  it('renders tab with file name', () => {
    const tab = createMockTab({ id: 'tab-1', fileName: 'notes.md' });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);
    expect(screen.getByText('notes.md')).toBeTruthy();
  });

  it('renders multiple tabs', () => {
    const tabs = [
      createMockTab({ id: 'tab-1', fileName: 'first.md' }),
      createMockTab({ id: 'tab-2', fileName: 'second.md', filePath: '/test/second.md' }),
      createMockTab({ id: 'tab-3', fileName: 'third.md', filePath: '/test/third.md' }),
    ];
    useEditorStore.setState({ tabs, activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);
    expect(screen.getByText('first.md')).toBeTruthy();
    expect(screen.getByText('second.md')).toBeTruthy();
    expect(screen.getByText('third.md')).toBeTruthy();
  });

  it('active tab has correct styling', () => {
    const tabs = [
      createMockTab({ id: 'tab-1', fileName: 'active.md' }),
      createMockTab({ id: 'tab-2', fileName: 'inactive.md', filePath: '/test/inactive.md' }),
    ];
    useEditorStore.setState({ tabs, activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const activeButton = screen.getByText('active.md').closest('button')!;
    const inactiveButton = screen.getByText('inactive.md').closest('button')!;

    expect(activeButton.className).toContain('bg-muted');
    expect(inactiveButton.className).toContain('bg-accent');
  });

  it('dirty indicator shows for unsaved tabs', () => {
    const tab = createMockTab({ id: 'tab-1', fileName: 'dirty.md', isDirty: true });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const button = screen.getByText('dirty.md').closest('button')!;
    // The dirty dot is a small round span — look for it by its class pattern.
    // After UI Refresh #6 the colour token is --color-accent-primary (was bg-primary).
    const spans = button.querySelectorAll('span');
    const dirtyDot = Array.from(spans).find(
      (s) => s.className.includes('rounded-full') && s.className.includes('w-1.5') && s.className.includes('h-1.5')
    );
    expect(dirtyDot).toBeTruthy();
  });

  it('no dirty indicator for clean tabs', () => {
    const tab = createMockTab({ id: 'tab-1', fileName: 'clean.md', isDirty: false });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const button = screen.getByText('clean.md').closest('button')!;
    const spans = button.querySelectorAll('span');
    const dirtyDot = Array.from(spans).find(
      (s) => s.className.includes('rounded-full') && s.className.includes('w-1.5') && s.className.includes('h-1.5')
    );
    expect(dirtyDot).toBeUndefined();
  });

  it('clicking a tab calls setActiveTab', () => {
    const setActiveTab = vi.fn();
    const tabs = [
      createMockTab({ id: 'tab-1', fileName: 'first.md' }),
      createMockTab({ id: 'tab-2', fileName: 'second.md', filePath: '/test/second.md' }),
    ];
    useEditorStore.setState({ tabs, activeTabId: 'tab-1', setActiveTab });

    renderWithProviders(<TabBar />);

    const secondTab = screen.getByText('second.md').closest('button')!;
    secondTab.click();

    expect(setActiveTab).toHaveBeenCalledWith('tab-2');
  });

  it('close button has correct aria-label', () => {
    const tab = createMockTab({ id: 'tab-1', fileName: 'note.md' });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const closeButton = screen.getByRole('button', { name: 'Close tab' });
    expect(closeButton).toBeTruthy();
  });

  it('shows line-through for deleted tabs', () => {
    const tab = createMockTab({ id: 'tab-1', fileName: 'deleted.md' });
    (tab as any).deleted = true;
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const fileNameSpan = screen.getByText('deleted.md');
    expect(fileNameSpan.className).toContain('line-through');
  });

  it('close button calls closeTab for clean tabs without confirm', () => {
    const closeTab = vi.fn();
    const tab = createMockTab({ id: 'tab-1', fileName: 'clean.md', isDirty: false });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1', closeTab });

    renderWithProviders(<TabBar />);

    const closeButton = screen.getByRole('button', { name: 'Close tab' });
    closeButton.click();

    expect(closeTab).toHaveBeenCalledWith('tab-1');
  });

  it('close button sets pendingCloseTabId for dirty tabs instead of closing', () => {
    const closeTab = vi.fn();
    const tab = createMockTab({ id: 'tab-1', fileName: 'dirty.md', isDirty: true });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1', closeTab });

    renderWithProviders(<TabBar />);

    const closeButton = screen.getByRole('button', { name: 'Close tab' });
    closeButton.click();

    // Should set pending state instead of calling closeTab
    expect(useEditorStore.getState().pendingCloseTabId).toBe('tab-1');
    expect(closeTab).not.toHaveBeenCalled();
  });

  it('does not use window.confirm for dirty tabs', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const tab = createMockTab({ id: 'tab-1', fileName: 'dirty.md', isDirty: true });
    useEditorStore.setState({ tabs: [tab], activeTabId: 'tab-1' });

    renderWithProviders(<TabBar />);

    const closeButton = screen.getByRole('button', { name: 'Close tab' });
    closeButton.click();

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
