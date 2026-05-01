// @vitest-environment jsdom

import '@/test/tauri-mock';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, fireEvent, act } from '@/test/component-harness';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useProjectMetadataStore, createDefaultMetadata } from '@/stores/project-metadata-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSyncStore } from '@/stores/sync-store';
import { ChatFooter } from '../ChatFooter';

// Mock hooks that pull in heavy deps
vi.mock('@/hooks/useGoalsDiscovery', () => ({
  useGoalsDiscovery: () => ({ goalFiles: [] }),
}));

vi.mock('@/hooks/useAIOperations', () => ({
  useAIOperations: () => ({ cancelChat: vi.fn() }),
}));

vi.mock('@/hooks/useChatContext', () => ({
  useChatContext: () => ({
    contextItems: [],
    dismissItem: vi.fn(),
    explicitAttachOffer: null,
    attachExplicit: vi.fn(),
  }),
}));

vi.mock('@/hooks/useSpeechRecognition', () => ({
  useSpeechRecognition: () => ({
    startDictation: vi.fn(),
    stopDictation: vi.fn(),
    isDictating: false,
    interimText: '',
    finalText: '',
  }),
}));

vi.mock('@/stores/skill-store', () => ({
  useSkillStore: (selector: (s: unknown) => unknown) =>
    selector({ getUserInvocableAgents: () => [] }),
}));

vi.mock('../AcpSessionControls', () => ({
  AcpSessionControls: () => null,
}));

vi.mock('../ExplainLockDialog', () => ({
  ExplainLockDialog: () => null,
}));

const PROJECT_PATH = '/Users/me/Projects/Alpha';

describe('ChatFooter — project multi-select check prominence', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [{ path: PROJECT_PATH, fileTree: [] }],
      explorerFolders: [],
    });

    useConnectionsStore.setState({ connections: [] });

    useProjectMetadataStore.setState({
      metadataMap: { [PROJECT_PATH]: createDefaultMetadata('Alpha') },
      dirtyPaths: new Set<string>(),
    });

    useSettingsStore.setState({
      showAgentModePicker: false,
      icloudAvailable: false,
      icloudNotesagePath: null,
      notesRootPath: '/test/notes',
    });

    useSyncStore.setState({
      icloudEnabled: false,
      syncedProjectPaths: [],
    });
  });

  it('project row Check has h-3.5 class and strokeWidth=2.5 when the project is selected', async () => {
    renderWithProviders(
      <ChatFooter
        onSend={vi.fn()}
        selectedProjectPaths={[PROJECT_PATH]}
        hasAIProvider={false}
        chatPlaceholder="Type a message..."
      />,
    );

    // Open the "+" consolidated menu to reveal the project multi-select
    const plusBtn = screen.getByRole('button', { name: /Add image or choose projects/i });
    await act(async () => {
      fireEvent.click(plusBtn);
    });

    // The selected project row should render a Check icon
    const checks = document.querySelectorAll('.lucide-check') as NodeListOf<SVGElement>;
    expect(checks.length, 'Expected at least one Check icon in the project picker').toBeGreaterThan(0);

    // Assert h-3.5 class (currently h-3 — RED)
    const hasH35 = Array.from(checks).some((svg) => svg.classList.contains('h-3.5'));
    expect(hasH35, 'Project check should have h-3.5 class (currently h-3)').toBe(true);

    // Assert stroke-width = 2.5 (currently not set — RED)
    const hasStrokeWidth = Array.from(checks).some(
      (svg) => svg.getAttribute('stroke-width') === '2.5',
    );
    expect(hasStrokeWidth, 'Project check should have stroke-width="2.5"').toBe(true);
  });
});
