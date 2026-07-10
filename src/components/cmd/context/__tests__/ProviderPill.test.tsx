// @vitest-environment jsdom

import '@/test/tauri-mock';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ProviderPill } from '../ProviderPill';
import type { Connection } from '@/lib/ai/connections';

// Radio content rendered inline; PickerItem rows dispatch value changes via a
// shared context — mirrors the CommandBarContext test harness.
type RadioCtx = { value: string; onValueChange?: (v: string) => void } | null;
const { PickerRadioGroupContext } = vi.hoisted((): {
  PickerRadioGroupContext: React.Context<RadioCtx>;
} => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactRuntime = require('react') as typeof import('react');
  return { PickerRadioGroupContext: ReactRuntime.createContext<RadioCtx>(null) };
});

vi.mock('@/components/ui/dropdown-menu', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    DropdownMenu: Pass,
    DropdownMenuTrigger: ({ children }: { children?: React.ReactNode; asChild?: boolean }) => <>{children}</>,
    DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="dropdown-content">{children}</div>
    ),
    DropdownMenuRadioGroup: ({
      children,
      value,
      onValueChange,
    }: {
      children?: React.ReactNode;
      value?: string;
      onValueChange?: (v: string) => void;
    }) => (
      <PickerRadioGroupContext.Provider value={{ value: value ?? '', onValueChange }}>
        {children}
      </PickerRadioGroupContext.Provider>
    ),
  };
});

vi.mock('@/components/ui/picker-item', () => ({
  PickerItem: ({ value, label }: { value: string; label: string }) => {
    const ctx = React.useContext(PickerRadioGroupContext);
    return (
      <button
        type="button"
        role="menuitemradio"
        aria-checked={ctx?.value === value}
        aria-label={label}
        onClick={() => ctx?.onValueChange?.(value)}
      >
        {label}
      </button>
    );
  },
}));

vi.mock('@/components/ProviderLogo', () => ({
  ProviderLogo: ({ provider }: { provider: string }) => (
    <span data-testid={`provider-logo-${provider}`}>{provider}</span>
  ),
}));

function conn(id: string, label: string): Connection {
  return {
    id,
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label,
    credentials: { type: 'api_key', key: 'sk-x' },
    capabilities: [],
    createdAt: 0,
  } as unknown as Connection;
}

const noop = () => {};

describe('ProviderPill — unlocked', () => {
  it('renders the active connection label and provider aria', () => {
    renderWithProviders(
      <ProviderPill
        connection={conn('c1', 'Claude')}
        connections={[conn('c1', 'Claude')]}
        onPick={noop}
        locked={false}
        lockedConnection={null}
        lockedProjectPaths={[]}
        onExplainLock={noop}
      />,
    );
    const pill = screen.getByTestId('cmd-bar-provider');
    expect(pill.getAttribute('data-locked')).toBe('false');
    expect(pill.getAttribute('aria-label')).toBe('Active provider: Claude');
  });

  it('renders "No provider" when no connection is active', () => {
    renderWithProviders(
      <ProviderPill
        connection={null}
        connections={[]}
        onPick={noop}
        locked={false}
        lockedConnection={null}
        lockedProjectPaths={[]}
        onExplainLock={noop}
      />,
    );
    expect(screen.getByText('No provider')).toBeTruthy();
  });

  it('calls onPick when a different connection is chosen', () => {
    const onPick = vi.fn();
    renderWithProviders(
      <ProviderPill
        connection={conn('c1', 'Claude')}
        connections={[conn('c1', 'Claude'), conn('c2', 'GPT')]}
        onPick={onPick}
        locked={false}
        lockedConnection={null}
        lockedProjectPaths={[]}
        onExplainLock={noop}
      />,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'GPT' }));
    expect(onPick).toHaveBeenCalledWith('c2');
  });

  it('does not call onPick when the already-active connection is re-selected', () => {
    const onPick = vi.fn();
    renderWithProviders(
      <ProviderPill
        connection={conn('c1', 'Claude')}
        connections={[conn('c1', 'Claude'), conn('c2', 'GPT')]}
        onPick={onPick}
        locked={false}
        lockedConnection={null}
        lockedProjectPaths={[]}
        onExplainLock={noop}
      />,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Claude' }));
    expect(onPick).not.toHaveBeenCalled();
  });
});

describe('ProviderPill — locked', () => {
  it('renders a static locked pill and opens the explain dialog on click', () => {
    const onExplainLock = vi.fn();
    const onPick = vi.fn();
    renderWithProviders(
      <ProviderPill
        connection={conn('c1', 'Claude')}
        connections={[conn('c1', 'Claude'), conn('c2', 'GPT')]}
        onPick={onPick}
        locked
        lockedConnection={conn('c1', 'Claude')}
        lockedProjectPaths={['/w/alpha']}
        onExplainLock={onExplainLock}
      />,
    );
    const pill = screen.getByTestId('cmd-bar-provider');
    expect(pill.getAttribute('data-locked')).toBe('true');
    expect(pill.getAttribute('aria-label')).toMatch(/Provider locked to Claude/);
    // No picker menu is rendered in locked mode.
    expect(screen.queryByRole('menuitemradio')).toBeNull();

    fireEvent.click(pill);
    expect(onExplainLock).toHaveBeenCalledWith(['/w/alpha']);
    expect(onPick).not.toHaveBeenCalled();
  });
});
