// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent } from '@/test/component-harness';
import { useSettingsStore } from '@/stores/settings-store';

// The sub-panels have heavy side-effects (connection probing, model metadata
// fetching, etc.). This test only cares that AISettings mounts them, labels
// its groups correctly, and wires the Tool Calling switches — so we swap
// them for lightweight test doubles.
vi.mock('@/components/settings/ConnectionsSettings', () => ({
  ConnectionsSettings: () => <div data-testid="connections-settings" />,
}));
vi.mock('@/components/settings/UseCaseRoutingSettings', () => ({
  UseCaseRoutingSettings: () => <div data-testid="use-case-routing-settings" />,
}));
vi.mock('@/components/settings/ApprovalsSettings', () => ({
  ApprovalsSettings: () => <div data-testid="approvals-settings" />,
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

  it('renders all group labels and inlines approvals', () => {
    renderWithProviders(<AISettings />);
    // Group headings — Connections / Use case mapping are section-level,
    // the rest are SettingsGroup labels.
    expect(screen.getByText('Connections')).toBeTruthy();
    expect(screen.getByText('Use case mapping')).toBeTruthy();
    expect(screen.getByText('Tool calling')).toBeTruthy();
    expect(screen.getByText('Project scope')).toBeTruthy();
    expect(screen.getByText('Network sandbox')).toBeTruthy();
    expect(screen.getByText('Persisted approvals')).toBeTruthy();

    // Sub-panels mounted inline (not via cross-panel navigation).
    expect(screen.getByTestId('connections-settings')).toBeTruthy();
    expect(screen.getByTestId('use-case-routing-settings')).toBeTruthy();
    expect(screen.getByTestId('approvals-settings')).toBeTruthy();
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

  // The standalone "Web search provider" display row was dropped (audit
  // batch 1, 2026-04-26) — it was a read-only label masquerading as a
  // setting, since `searchProvider` is a literal with no setter. The
  // DuckDuckGo info now lives in the "Enable tool calling" description.
  it('"Enable tool calling" description discloses provider-native + DuckDuckGo fallback', () => {
    renderWithProviders(<AISettings />);
    // Privacy disclosure — users should see where search queries go,
    // including the fallback for providers without server-side search.
    expect(
      screen.getByText(/queries are sent to DuckDuckGo/i),
    ).toBeTruthy();
  });
});
