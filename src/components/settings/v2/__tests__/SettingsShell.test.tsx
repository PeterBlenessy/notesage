// @vitest-environment jsdom

import '@/test/tauri-mock';
import * as React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { Sun, Sliders, Sparkles } from 'lucide-react';
import {
  renderWithProviders,
  screen,
  fireEvent,
  act,
} from '@/test/component-harness';
import {
  SettingsShell,
  type SettingsShellNavGroup,
} from '@/components/settings/v2/SettingsShell';

const NAV: SettingsShellNavGroup[] = [
  {
    id: 'notesage',
    label: 'Notesage',
    items: [
      { id: 'appearance', label: 'Appearance', icon: Sun },
      { id: 'editor', label: 'Editor', icon: Sliders },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    items: [{ id: 'ai', label: 'AI & Agents', icon: Sparkles, hint: '3' }],
  },
];

function renderShell(props: {
  activeItem?: string;
  onActiveItemChange?: (id: string) => void;
  navHeader?: React.ReactNode;
}) {
  const onActiveItemChange = props.onActiveItemChange ?? vi.fn();
  const result = renderWithProviders(
    <SettingsShell
      open
      onOpenChange={() => {}}
      nav={NAV}
      activeItem={props.activeItem ?? 'appearance'}
      onActiveItemChange={onActiveItemChange}
      navHeader={props.navHeader}
    >
      <div data-testid="panel">Panel body</div>
    </SettingsShell>,
  );
  return { ...result, onActiveItemChange };
}

function getNavButton(id: string): HTMLButtonElement {
  const el = document.querySelector(
    `[data-nav-item-id="${id}"]`,
  ) as HTMLButtonElement | null;
  if (!el) throw new Error(`nav button ${id} not found`);
  return el;
}

describe('SettingsShell', () => {
  it('renders group labels and all nav items', () => {
    renderShell({});
    expect(screen.getByText('Notesage')).toBeTruthy();
    expect(screen.getByText('Workspace')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();
    expect(screen.getByText('Editor')).toBeTruthy();
    expect(screen.getByText('AI & Agents')).toBeTruthy();
    // Panel body rendered in the content column
    expect(screen.getByTestId('panel')).toBeTruthy();
  });

  it('marks the active item with aria-current="page"', () => {
    renderShell({ activeItem: 'editor' });
    expect(getNavButton('editor').getAttribute('aria-current')).toBe('page');
    expect(getNavButton('appearance').getAttribute('aria-current')).toBeNull();
    expect(getNavButton('ai').getAttribute('aria-current')).toBeNull();
  });

  it('calls onActiveItemChange when a nav item is clicked', () => {
    const onActiveItemChange = vi.fn();
    renderShell({ activeItem: 'appearance', onActiveItemChange });
    act(() => {
      fireEvent.click(getNavButton('editor'));
    });
    expect(onActiveItemChange).toHaveBeenCalledWith('editor');
  });

  it('ArrowDown moves selection to the next item and wraps at the end', () => {
    const onActiveItemChange = vi.fn();
    const { rerender } = renderShell({
      activeItem: 'appearance',
      onActiveItemChange,
    });

    // appearance → editor
    act(() => {
      fireEvent.keyDown(getNavButton('appearance'), { key: 'ArrowDown' });
    });
    expect(onActiveItemChange).toHaveBeenLastCalledWith('editor');

    // Re-render with editor active, arrow down → ai
    rerender(
      <SettingsShell
        open
        onOpenChange={() => {}}
        nav={NAV}
        activeItem="editor"
        onActiveItemChange={onActiveItemChange}
      >
        <div />
      </SettingsShell>,
    );
    act(() => {
      fireEvent.keyDown(getNavButton('editor'), { key: 'ArrowDown' });
    });
    expect(onActiveItemChange).toHaveBeenLastCalledWith('ai');

    // Re-render with last item active, arrow down wraps to first
    rerender(
      <SettingsShell
        open
        onOpenChange={() => {}}
        nav={NAV}
        activeItem="ai"
        onActiveItemChange={onActiveItemChange}
      >
        <div />
      </SettingsShell>,
    );
    act(() => {
      fireEvent.keyDown(getNavButton('ai'), { key: 'ArrowDown' });
    });
    expect(onActiveItemChange).toHaveBeenLastCalledWith('appearance');
  });

  it('ArrowUp moves selection to the previous item and wraps at the start', () => {
    const onActiveItemChange = vi.fn();
    renderShell({ activeItem: 'appearance', onActiveItemChange });

    // appearance → wraps to last (ai)
    act(() => {
      fireEvent.keyDown(getNavButton('appearance'), { key: 'ArrowUp' });
    });
    expect(onActiveItemChange).toHaveBeenLastCalledWith('ai');
  });

  it('Enter on a nav item activates it (native button click)', () => {
    const onActiveItemChange = vi.fn();
    renderShell({ activeItem: 'appearance', onActiveItemChange });
    // Native <button> fires onClick on Enter via the browser. Simulate the click
    // path: the button is a real button so fireEvent.click is equivalent to
    // Enter being pressed while it's focused.
    act(() => {
      fireEvent.click(getNavButton('ai'));
    });
    expect(onActiveItemChange).toHaveBeenLastCalledWith('ai');
  });

  it('renders navHeader above the groups when provided', () => {
    renderShell({
      navHeader: <div data-testid="nav-header">Search placeholder</div>,
    });
    const header = screen.getByTestId('nav-header');
    expect(header).toBeTruthy();

    // Header must appear before the first group label in document order.
    const firstGroupLabel = screen.getByText('Notesage');
    expect(
      header.compareDocumentPosition(firstGroupLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders hint when provided on an item', () => {
    renderShell({});
    // "3" is the hint on the AI & Agents item.
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders a close button with an accessible label', () => {
    renderShell({});
    const closeBtn = screen.getByLabelText('Close settings');
    expect(closeBtn).toBeTruthy();
  });

  it('Escape closes the dialog (calls onOpenChange with false)', () => {
    const onOpenChange = vi.fn();
    renderWithProvidersOpen({ onOpenChange });
    act(() => {
      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: 'Escape',
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders the dialog content with role="dialog" (Radix focus trap host)', () => {
    // Radix Dialog provides the focus trap. Confirming the dialog content
    // exists is our regression lock that we are still mounted on top of
    // DialogPrimitive.Content (not a div) so the trap stays active.
    renderShell({});
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute('data-slot')).toBe('settings-shell-content');
  });
});

function renderWithProvidersOpen(props: {
  onOpenChange: (open: boolean) => void;
}) {
  return renderWithProviders(
    <SettingsShell
      open
      onOpenChange={props.onOpenChange}
      nav={NAV}
      activeItem="appearance"
      onActiveItemChange={() => {}}
    >
      <div />
    </SettingsShell>,
  );
}
