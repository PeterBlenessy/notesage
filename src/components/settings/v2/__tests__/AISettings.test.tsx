// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { useSettingsStore } from '@/stores/settings-store';

// The sub-panels have heavy side-effects (connection probing, model metadata
// fetching, etc.). This test only cares that AISettings mounts them, labels
// its groups correctly, and wires the Tool Calling switches + Privacy nav
// button — so we swap them for lightweight test doubles.
vi.mock('@/components/settings/ConnectionsSettings', () => ({
  ConnectionsSettings: () => <div data-testid="connections-settings" />,
}));
vi.mock('@/components/settings/UseCaseRoutingSettings', () => ({
  UseCaseRoutingSettings: () => <div data-testid="use-case-routing-settings" />,
}));

import { AISettings } from '@/components/settings/v2/AISettings';

describe('AISettings (v2)', () => {
  // Snapshot the store values we mutate so other tests aren't affected by
  // the toggles we flip here. Persisted settings bleed across tests
  // otherwise because Zustand + localStorage share module state.
  let initialToolCallingEnabled: boolean;
  let initialRequireAllToolConfirmations: boolean;

  beforeEach(() => {
    const s = useSettingsStore.getState();
    initialToolCallingEnabled = s.toolCallingEnabled;
    initialRequireAllToolConfirmations = s.requireAllToolConfirmations;
  });

  afterEach(() => {
    const s = useSettingsStore.getState();
    s.setToolCallingEnabled(initialToolCallingEnabled);
    s.setRequireAllToolConfirmations(initialRequireAllToolConfirmations);
  });

  it('renders all five group labels', () => {
    renderWithProviders(<AISettings />);
    // Group headings — Connections / Routing are section-level, Tool calling
    // / Network sandbox / Persisted approvals are SettingsGroup labels.
    expect(screen.getByText('Connections')).toBeTruthy();
    expect(screen.getByText('Routing')).toBeTruthy();
    expect(screen.getByText('Tool calling')).toBeTruthy();
    expect(screen.getByText('Network sandbox')).toBeTruthy();
    expect(screen.getByText('Persisted approvals')).toBeTruthy();

    // The mocked sub-panels are mounted inside the Connections / Routing
    // groups.
    expect(screen.getByTestId('connections-settings')).toBeTruthy();
    expect(screen.getByTestId('use-case-routing-settings')).toBeTruthy();
  });

  it('Tool calling Switch reflects settings.toolCallingEnabled and toggles via setter', () => {
    useSettingsStore.getState().setToolCallingEnabled(true);
    renderWithProviders(<AISettings />);

    const toggle = screen.getByLabelText('Enable tool calling');
    expect(toggle).toBeTruthy();
    // Radix Switch exposes `aria-checked`; should start true.
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().toolCallingEnabled).toBe(false);
  });

  it('"Require confirmation" Switch mirrors requireAllToolConfirmations', () => {
    useSettingsStore.getState().setRequireAllToolConfirmations(false);
    renderWithProviders(<AISettings />);

    const toggle = screen.getByLabelText(
      'Require confirmation for every tool call',
    );
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().requireAllToolConfirmations).toBe(true);
  });

  it('Web search provider display shows "DuckDuckGo"', () => {
    renderWithProviders(<AISettings />);
    const display = screen.getByTestId('ai-search-provider');
    expect(display.textContent).toBe('DuckDuckGo');
  });

  it('"Open Privacy settings" button dispatches notesage:open-settings-panel with { panel: "privacy" }', () => {
    renderWithProviders(<AISettings />);
    const button = screen.getByRole('button', { name: 'Open Privacy settings' });
    expect(button).toBeTruthy();

    const listener = vi.fn();
    const handler = (e: Event) => {
      listener((e as CustomEvent).detail);
    };
    window.addEventListener('notesage:open-settings-panel', handler);

    try {
      fireEvent.click(button);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ panel: 'privacy' });
    } finally {
      window.removeEventListener('notesage:open-settings-panel', handler);
    }
  });
});
