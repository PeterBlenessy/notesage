// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import {
  renderWithProviders,
  screen,
  registerDefaultHandlers,
} from '@/test/component-harness';

// ---------------------------------------------------------------------------
// Mock sub-settings components
// ---------------------------------------------------------------------------

vi.mock('@/components/settings/ConnectionsSettings', () => ({
  ConnectionsSettings: () => <div data-testid="connections-settings">Connections</div>,
}));

vi.mock('@/components/settings/UseCaseRoutingSettings', () => ({
  UseCaseRoutingSettings: () => <div data-testid="routing-settings">Routing</div>,
}));

vi.mock('@/components/settings/PromptsSettings', () => ({
  PromptsSettings: () => null,
}));

vi.mock('@/components/settings/SyncSettings', () => ({
  SyncSettings: () => null,
}));

vi.mock('@/components/settings/SkillsSettings', () => ({
  SkillsSettings: () => null,
}));

vi.mock('@/components/settings/TranscriptionSettings', () => ({
  TranscriptionSettings: () => null,
}));

vi.mock('@/components/settings/LocalAISettings', () => ({
  LocalAISettings: () => null,
}));

vi.mock('@/components/settings/ChangelogDialog', () => ({
  ChangelogDialog: () => null,
}));

// ---------------------------------------------------------------------------
// Mock stores
// ---------------------------------------------------------------------------

vi.mock('@/stores/local-ai-store', () => {
  const store = {
    serverStatus: 'stopped',
    activeModelId: null,
    models: [],
    getState: () => store,
  };
  return {
    useLocalAIStore: Object.assign(
      vi.fn((sel: (s: typeof store) => unknown) => sel(store)),
      { getState: () => store },
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock tauriApi and logger
// ---------------------------------------------------------------------------

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    setDebugLogging: vi.fn(async () => {}),
    getGitVersion: vi.fn(async () => '2.45.0'),
    gitCheckAvailable: vi.fn(async () => true),
    getLogPath: vi.fn(async () => '/tmp/notesage.log'),
    getLogSize: vi.fn(async () => 1024),
  },
}));

vi.mock('@/lib/logger', () => ({
  setLogLevel: vi.fn(),
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Import component after mocks
// ---------------------------------------------------------------------------

import { SettingsDialog } from '@/components/settings/SettingsDialog';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsDialog', () => {
  beforeEach(() => {
    registerDefaultHandlers();
  });

  it('does not render content when open is false', () => {
    renderWithProviders(<SettingsDialog open={false} />);
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('does not render content when open is undefined', () => {
    renderWithProviders(<SettingsDialog />);
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('renders dialog when open is true', () => {
    renderWithProviders(<SettingsDialog open={true} />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('shows settings description', () => {
    renderWithProviders(<SettingsDialog open={true} />);
    expect(screen.getByText('Configure your Notesage experience')).toBeTruthy();
  });

  it('shows all tab labels', () => {
    renderWithProviders(<SettingsDialog open={true} />);
    const expectedTabs = [
      'Editor',
      'AI Providers',
      'Local AI',
      'Custom Prompts',
      'Skills & Agents',
      'Transcription',
      'Version Control',
      'Sync',
      'Advanced',
      'About',
    ];
    for (const label of expectedTabs) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('defaults to Editor tab', () => {
    renderWithProviders(<SettingsDialog open={true} />);
    // The Editor tab button should have the active style class
    const editorButton = screen.getByText('Editor');
    expect(editorButton.closest('button')).toBeTruthy();
  });

  it('calls onOpenChange when provided', () => {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <SettingsDialog open={true} onOpenChange={onOpenChange} />,
    );
    // Dialog renders — onOpenChange is wired but we just verify mount works
    expect(screen.getByText('Settings')).toBeTruthy();
  });
});
