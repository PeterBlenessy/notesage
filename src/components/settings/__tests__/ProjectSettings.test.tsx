// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderWithProviders, screen, fireEvent, act } from '@/test/component-harness';
import { ProjectSettings } from '@/components/settings/ProjectSettings';
import { useProjectMetadataStore, createDefaultMetadata } from '@/stores/project-metadata-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { Connection } from '@/lib/ai/connections';

vi.mock('@/stores/skill-store', () => ({
  useSkillStore: (selector: (s: unknown) => unknown) =>
    selector({
      getUserInvocableAgents: () => [],
    }),
}));

const PROJECT_PATH = '/Users/me/Projects/Alpha';

function seedConnections() {
  const connA: Connection = {
    id: 'conn-claude',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Claude Sonnet',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive'],
    createdAt: 1,
  };
  const connB: Connection = {
    id: 'conn-openai',
    provider: 'openai',
    authMethod: 'api_key',
    status: 'connected',
    label: 'OpenAI GPT-4o',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive'],
    createdAt: 2,
  };
  useConnectionsStore.setState({ connections: [connA, connB] });
}

function seedMetadata(withLock: boolean) {
  const meta = createDefaultMetadata('Alpha');
  if (withLock) {
    meta.aiLock = {
      connectionId: 'conn-claude',
      lockedAt: new Date('2026-04-19').getTime(),
      reason: 'sensitive client data',
    };
  }
  useProjectMetadataStore.setState({
    metadataMap: { [PROJECT_PATH]: meta },
    dirtyPaths: new Set<string>(),
  });
}

describe('ProjectSettings — AI Provider Lock', () => {
  beforeEach(() => {
    useProjectMetadataStore.setState({ metadataMap: {}, dirtyPaths: new Set<string>() });
    useConnectionsStore.setState({ connections: [] });
    useSettingsStore.setState({
      icloudAvailable: false,
      icloudNotesagePath: null,
      notesRootPath: '/test/notes',
    });
    seedConnections();
  });

  it('renders "Not locked" state with a Lock button when aiLock is unset', () => {
    seedMetadata(false);
    renderWithProviders(<ProjectSettings projectPath={PROJECT_PATH} />);

    expect(screen.getByText('AI Provider Lock')).toBeTruthy();
    expect(screen.getByText('Not locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Lock to provider/i })).toBeTruthy();
  });

  it('renders "Locked" state with connection label, date, reason, and Unlock button when aiLock is set', () => {
    seedMetadata(true);
    renderWithProviders(<ProjectSettings projectPath={PROJECT_PATH} />);

    expect(screen.getByText('Locked')).toBeTruthy();
    // Connection label surfaced
    expect(screen.getByText('Claude Sonnet')).toBeTruthy();
    // Reason surfaced (quotes stripped by parser)
    expect(screen.getByText(/sensitive client data/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Unlock/i })).toBeTruthy();
  });

  it('opens unlock confirmation dialog and clears aiLock on confirm', async () => {
    seedMetadata(true);
    renderWithProviders(<ProjectSettings projectPath={PROJECT_PATH} />);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /Unlock/i }));
    });

    expect(screen.getByText(/Unlock this project\?/i)).toBeTruthy();

    act(() => {
      // AlertDialogAction rendered as "Unlock" button — find the one inside the dialog
      const buttons = screen.getAllByRole('button', { name: /^Unlock$/i });
      fireEvent.click(buttons[buttons.length - 1]);
    });

    const meta = useProjectMetadataStore.getState().metadataMap[PROJECT_PATH];
    expect(meta?.aiLock).toBeUndefined();
    expect(useProjectMetadataStore.getState().dirtyPaths.has(PROJECT_PATH)).toBe(true);
  });

  it('disables Lock to provider button when no connections are available', () => {
    useConnectionsStore.setState({ connections: [] });
    seedMetadata(false);
    renderWithProviders(<ProjectSettings projectPath={PROJECT_PATH} />);

    const lockBtn = screen.getByRole('button', { name: /Lock to provider/i }) as HTMLButtonElement;
    expect(lockBtn.disabled).toBe(true);
  });
});
