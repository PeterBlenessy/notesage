// @vitest-environment jsdom

import '@/test/tauri-mock';
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { ProviderQuickConfig } from '../ProviderQuickConfig';
import { useConnectionsStore } from '@/stores/connections-store';
import { useLocalAIStore } from '@/stores/local-ai-store';
import { prettyModelName } from '@/lib/ai/connections';
import type { Connection } from '@/lib/ai/connections';
import type { LocalModelInfo } from '@/lib/tauri';

// Radio content inline; PickerItem rows dispatch value changes via context.
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

function localModel(id: string): LocalModelInfo {
  return {
    id,
    name: id,
    filename: `${id}.gguf`,
    size_bytes: 0,
    ram_required_bytes: 0,
    downloaded: true,
    description: '',
    huggingface_url: '',
    is_custom: false,
    source: 'catalog',
    supports_fim: false,
    supports_tool_calling: true,
    supports_thinking: false,
    supports_vision: false,
    multilingual: false,
    recommended_for: [],
  };
}

function localConnection(): Connection {
  return {
    id: 'local-1',
    provider: 'local_ai',
    authMethod: 'local_bundled',
    status: 'connected',
    label: 'Local AI',
    credentials: { type: 'none' },
    capabilities: [],
    createdAt: 0,
  } as unknown as Connection;
}

describe('ProviderQuickConfig', () => {
  beforeEach(() => {
    useConnectionsStore.setState({ connections: [localConnection()] });
    useLocalAIStore.setState({ models: [] });
  });

  it('renders the config gear with its accessible label', () => {
    renderWithProviders(<ProviderQuickConfig connection={localConnection()} />);
    expect(screen.getByRole('button', { name: 'Provider quick config' })).toBeTruthy();
  });

  it('lists the downloaded local models plus a Default option', () => {
    useLocalAIStore.setState({ models: [localModel('qwen3-8b')] });
    renderWithProviders(<ProviderQuickConfig connection={localConnection()} />);
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: prettyModelName('qwen3-8b') })).toBeTruthy();
  });

  it('writes the picked model back to the connection config', () => {
    useLocalAIStore.setState({ models: [localModel('qwen3-8b')] });
    renderWithProviders(<ProviderQuickConfig connection={localConnection()} />);

    fireEvent.click(screen.getByRole('menuitemradio', { name: prettyModelName('qwen3-8b') }));

    const updated = useConnectionsStore.getState().connections.find((c) => c.id === 'local-1');
    expect(updated?.config?.model).toBe('qwen3-8b');
  });

  it('shows an empty state when no models are available', () => {
    useLocalAIStore.setState({ models: [] });
    renderWithProviders(<ProviderQuickConfig connection={localConnection()} />);
    expect(screen.getByText('No models available')).toBeTruthy();
  });
});
