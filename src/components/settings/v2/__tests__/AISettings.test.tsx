// @vitest-environment jsdom

import '@/test/tauri-mock';
// Radix Slider (the Max concurrent sessions control) uses ResizeObserver.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
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
    expect(screen.getByText('Use Case Mapping')).toBeTruthy();
    expect(screen.getByText('Tool Calling')).toBeTruthy();
    expect(screen.getByText('Project Scope')).toBeTruthy();
    expect(screen.getByText('Network Sandbox')).toBeTruthy();
    expect(screen.getByText('Persisted Approvals')).toBeTruthy();

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

  // -----------------------------------------------------------------------
  // Issue #421 — "Permission scopes" grouping
  // The four access/isolation groups (Tool Calling, Project Scope, Network
  // Sandbox, Persisted Approvals) must appear under a clearly labeled
  // "Permission scopes" section heading so the label matches the codebase
  // vocabulary (*Scope types, getChatSandboxScope, etc.).
  // -----------------------------------------------------------------------

  it('renders a "Permission scopes" section heading grouping the four access/isolation groups', () => {
    renderWithProviders(<AISettings />);
    // The new section heading must be present in the rendered output.
    expect(screen.getByText('Permission scopes')).toBeTruthy();
  });

  it('does not render a user-visible "Privacy" heading for the access/isolation groups', () => {
    renderWithProviders(<AISettings />);
    // "Privacy" as a heading for these groups is the old, misleading label.
    // Ensure no element with that exact text exists as a heading element.
    const allHeadings = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
    const privacyHeading = Array.from(allHeadings).find((el) =>
      el.textContent?.trim() === 'Privacy',
    );
    expect(privacyHeading).toBeUndefined();
  });

  it('Tool Calling group remains visible when settings search query is "privacy" (synonym)', async () => {
    // When a user searches the old "Privacy" label they should still find
    // the permission-scope controls. Tool Calling and Project Scope have
    // SettingsRow children so they would otherwise hide when no row text
    // matches — the synonym mechanism must keep them visible.
    const { SettingsSearchContext } = await import(
      '@/components/settings/v2/SettingsSearch'
    );
    renderWithProviders(
      <SettingsSearchContext.Provider value={{ query: 'privacy' }}>
        <AISettings />
      </SettingsSearchContext.Provider>,
    );
    // The Tool Calling group must remain visible under the "privacy" query.
    expect(screen.getByText('Tool Calling')).toBeTruthy();
    // The Project Scope group must also remain visible.
    expect(screen.getByText('Project Scope')).toBeTruthy();
  });
});
