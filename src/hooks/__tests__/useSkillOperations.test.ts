// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSkillStore } from '@/stores/skill-store';
import { useAIStore } from '@/stores/ai-store';
import { usePermissionStore } from '@/stores/permission-store';
import type { Connection } from '@/lib/ai/connections';

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock('@/lib/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock tauriApi — the module under test imports it at the top level
const mockGetHomeDir = vi.fn(async () => '/Users/test');
const mockExtractBundledSkills = vi.fn(async () => '/Users/test/.notesage/bundled-skills');
const mockExtractBundledAgents = vi.fn(async () => '/Users/test/.notesage/bundled-agents');
const mockPathExists = vi.fn(async (_path: string) => false);
const mockCreateDirectory = vi.fn(async () => {});
const mockWriteFile = vi.fn(async () => {});
const mockReadSkillContent = vi.fn(async () => ({
  path: '/test/skill',
  readme: '# Skill',
  scripts: [],
}));
const mockReadAgentContent = vi.fn(async () => ({
  path: '/test/agent.md',
  name: 'Test Agent',
  description: 'A test agent',
  instructions: 'Do things',
}));
const mockExecuteSkillScript = vi.fn(async () => ({
  exitCode: 0,
  stdout: 'output',
  stderr: '',
}));

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    getHomeDir: (...args: unknown[]) => mockGetHomeDir(...args),
    extractBundledSkills: (...args: unknown[]) => mockExtractBundledSkills(...args),
    extractBundledAgents: (...args: unknown[]) => mockExtractBundledAgents(...args),
    pathExists: (path: string) => mockPathExists(path),
    createDirectory: (...args: unknown[]) => mockCreateDirectory(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readSkillContent: (...args: unknown[]) => mockReadSkillContent(...args),
    readAgentContent: (...args: unknown[]) => mockReadAgentContent(...args),
    executeSkillScript: (...args: unknown[]) => mockExecuteSkillScript(...args),
  },
}));

// Import hooks under test (uses mocked tauriApi)
import { useSkillDiscovery, useSkillOperations } from '@/hooks/useSkillOperations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: 'conn-test',
    provider: 'anthropic',
    authMethod: 'api_key',
    status: 'connected',
    label: 'Test Anthropic',
    credentials: { type: 'api_key', credentialStored: true },
    capabilities: ['interactive', 'agent_tasks'],
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeAgentManagedConnection(
  provider: Connection['provider'],
  overrides: Partial<Connection> = {},
): Connection {
  return makeConnection({
    provider,
    authMethod: 'agent_managed',
    label: `${provider} Agent`,
    credentials: { type: 'agent_managed', agentBinary: `${provider}-acp` },
    ...overrides,
  });
}

function resetStores() {
  useSettingsStore.setState({
    startupReady: false,
    personasMigrated: true, // Default to true to skip migration unless testing it
  });
  useConnectionsStore.setState({ connections: [] });
  useWorkspaceStore.setState({ projects: [], explorerFolders: [] });
  useSkillStore.setState({
    skills: [],
    agents: [],
    agentInstructions: [],
    rescanCounter: 0,
    isScanning: false,
    lastScanTimestamp: 0,
    activeAgentName: 'general-assistant',
    enabledOverrides: {},
    agentEnabledOverrides: {},
  });
  useAIStore.setState({
    activePersonaId: 'general',
    customPersonas: [],
  });
  usePermissionStore.setState({
    skillScriptSession: new Set<string>(),
    skillScriptAlways: [],
  });
}

/** Set up store spy methods for skill/agent scanning. */
function setupStoreMocks() {
  const scanSkills = vi.fn(async () => {});
  const scanAgents = vi.fn(async () => {});
  const scanAgentInstructions = vi.fn(async () => {});
  const setActiveAgent = vi.fn();

  useSkillStore.setState({
    scanSkills,
    scanAgents,
    scanAgentInstructions,
    setActiveAgent,
    skills: [],
    agents: [],
  } as unknown as Parameters<typeof useSkillStore.setState>[0]);

  return { scanSkills, scanAgents, scanAgentInstructions, setActiveAgent };
}

// ---------------------------------------------------------------------------
// Tests: useSkillDiscovery
// ---------------------------------------------------------------------------

// NOTE: `bundledExtracted` is a module-level `let` in useSkillOperations.ts.
// It starts as `false` and flips to `true` on the first successful run.
// Since we cannot reset it between tests (same module instance), the first
// test that triggers the pipeline will extract, and subsequent tests will not.
// We test extraction behavior in the first test and verify skip in a later one.

describe('useSkillDiscovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();

    mockGetHomeDir.mockResolvedValue('/Users/test');
    mockExtractBundledSkills.mockResolvedValue('/Users/test/.notesage/bundled-skills');
    mockExtractBundledAgents.mockResolvedValue('/Users/test/.notesage/bundled-agents');
    mockPathExists.mockResolvedValue(false);
    mockCreateDirectory.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('does not run when startupReady is false', async () => {
    useSettingsStore.setState({ startupReady: false });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockExtractBundledSkills).not.toHaveBeenCalled();
    expect(mockGetHomeDir).not.toHaveBeenCalled();
  });

  // This MUST be the first test that sets startupReady=true so bundledExtracted
  // is still false and extraction runs.
  it('runs full discovery pipeline including extraction on first run', async () => {
    const { scanSkills, scanAgents, scanAgentInstructions } = setupStoreMocks();
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Extraction should run on first invocation
    expect(mockExtractBundledSkills).toHaveBeenCalledTimes(1);
    expect(mockExtractBundledAgents).toHaveBeenCalledTimes(1);
    expect(mockGetHomeDir).toHaveBeenCalled();
    expect(scanSkills).toHaveBeenCalledTimes(1);
    expect(scanAgents).toHaveBeenCalledTimes(1);
    expect(scanAgentInstructions).toHaveBeenCalledTimes(1);
  });

  // After the first test, bundledExtracted is true. Subsequent runs skip extraction.
  it('skips extraction on subsequent runs (bundledExtracted flag)', async () => {
    const { scanSkills, scanAgents } = setupStoreMocks();
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Extraction NOT called (bundledExtracted already true from previous test)
    expect(mockExtractBundledSkills).not.toHaveBeenCalled();
    expect(mockExtractBundledAgents).not.toHaveBeenCalled();
    // But scanning still runs
    expect(scanSkills).toHaveBeenCalledTimes(1);
    expect(scanAgents).toHaveBeenCalledTimes(1);
  });

  it('includes project paths in skill and agent directories', async () => {
    const { scanSkills, scanAgents } = setupStoreMocks();

    useWorkspaceStore.setState({
      projects: [
        { path: '/projects/alpha', fileTree: [] },
        { path: '/projects/beta', fileTree: [] },
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = scanSkills.mock.calls[0][0] as string[];
    expect(skillDirs).toContain('/Users/test/.notesage/skills');
    expect(skillDirs).toContain('/projects/alpha/.notesage/skills');
    expect(skillDirs).toContain('/projects/beta/.notesage/skills');

    const agentDirs = scanAgents.mock.calls[0][0] as string[];
    expect(agentDirs).toContain('/Users/test/.notesage/agents');
    expect(agentDirs).toContain('/projects/alpha/.notesage/agents');
    expect(agentDirs).toContain('/projects/beta/.notesage/agents');
    expect(agentDirs).toContain('/projects/alpha/.github/agents');
    expect(agentDirs).toContain('/projects/beta/.github/agents');
  });

  it('includes provider-specific paths for agent_managed connections', async () => {
    const { scanSkills, scanAgents } = setupStoreMocks();

    useConnectionsStore.setState({
      connections: [
        makeAgentManagedConnection('anthropic'),
        makeAgentManagedConnection('openai', { id: 'conn-openai' }),
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = scanSkills.mock.calls[0][0] as string[];
    expect(skillDirs).toContain('/Users/test/.claude/skills');
    expect(skillDirs).toContain('/Users/test/.codex/skills');

    const agentDirs = scanAgents.mock.calls[0][0] as string[];
    expect(agentDirs).toContain('/Users/test/.claude/agents');
    expect(agentDirs).toContain('/Users/test/.codex/agents');
  });

  it('skips non-agent_managed connections for provider skill paths', async () => {
    const { scanSkills } = setupStoreMocks();

    useConnectionsStore.setState({
      connections: [
        makeConnection({
          id: 'conn-api',
          provider: 'anthropic',
          authMethod: 'api_key',
          status: 'connected',
        }),
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = scanSkills.mock.calls[0][0] as string[];
    // Only the global dir, no provider-specific paths
    expect(skillDirs).toEqual(['/Users/test/.notesage/skills']);
  });

  it('deduplicates provider paths from multiple connections', async () => {
    const { scanSkills } = setupStoreMocks();

    // Two Google connections — both resolve to the same paths
    useConnectionsStore.setState({
      connections: [
        makeAgentManagedConnection('google', { id: 'conn-g1' }),
        makeAgentManagedConnection('google', { id: 'conn-g2' }),
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = scanSkills.mock.calls[0][0] as string[];
    const geminiCount = skillDirs.filter((d) => d === '/Users/test/.gemini/skills').length;
    const agentsCount = skillDirs.filter((d) => d === '/Users/test/.agents/skills').length;
    expect(geminiCount).toBe(1);
    expect(agentsCount).toBe(1);
  });

  it('includes GitHub agent paths for non-agent_managed github connections', async () => {
    const { scanAgents } = setupStoreMocks();

    // Copilot LSP connection (not agent_managed) — still gets agent paths
    useConnectionsStore.setState({
      connections: [
        makeConnection({
          id: 'conn-copilot-lsp',
          provider: 'github',
          authMethod: 'api_key',
          status: 'connected',
        }),
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const agentDirs = scanAgents.mock.calls[0][0] as string[];
    expect(agentDirs).toContain('/Users/test/.github/agents');
  });

  it('handles home directory failure gracefully', async () => {
    mockGetHomeDir.mockRejectedValue(new Error('no home'));

    const { scanSkills } = setupStoreMocks();
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Should abort without calling scanSkills
    expect(scanSkills).not.toHaveBeenCalled();
  });

  it('rescans when rescanCounter changes', async () => {
    const { scanSkills } = setupStoreMocks();
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    const { rerender } = renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(scanSkills).toHaveBeenCalledTimes(1);

    // Trigger rescan by bumping the counter
    act(() => {
      useSkillStore.setState({ rescanCounter: 1 });
    });

    await act(async () => {
      rerender();
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(scanSkills).toHaveBeenCalledTimes(2);
  });

  it('passes first project and connected provider types to scanAgentInstructions', async () => {
    const { scanAgentInstructions } = setupStoreMocks();

    useWorkspaceStore.setState({
      projects: [{ path: '/projects/first', fileTree: [] }],
    });
    useConnectionsStore.setState({
      connections: [
        makeAgentManagedConnection('anthropic', { status: 'connected' }),
        makeConnection({
          id: 'conn-google',
          provider: 'google',
          authMethod: 'agent_managed',
          status: 'connected',
          credentials: { type: 'agent_managed', agentBinary: 'gemini' },
        }),
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(scanAgentInstructions).toHaveBeenCalledWith(
      '/projects/first',
      expect.arrayContaining(['claude-code', 'gemini']),
    );
  });

  it('skips disconnected connections for provider paths', async () => {
    const { scanSkills } = setupStoreMocks();

    useConnectionsStore.setState({
      connections: [
        makeAgentManagedConnection('anthropic', { status: 'disconnected' as Connection['status'] }),
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = scanSkills.mock.calls[0][0] as string[];
    // Should not include provider paths for disconnected connections
    expect(skillDirs).not.toContain('/Users/test/.claude/skills');
  });
});

// ---------------------------------------------------------------------------
// Tests: persona migration (runs through useSkillDiscovery pipeline)
// ---------------------------------------------------------------------------

describe('persona migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();

    mockGetHomeDir.mockResolvedValue('/Users/test');
    mockExtractBundledSkills.mockResolvedValue('/Users/test/.notesage/bundled-skills');
    mockExtractBundledAgents.mockResolvedValue('/Users/test/.notesage/bundled-agents');
    mockPathExists.mockResolvedValue(false);
    mockCreateDirectory.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('migrates custom personas to agent .md files', async () => {
    setupStoreMocks();

    useAIStore.setState({
      activePersonaId: 'general',
      customPersonas: [
        {
          id: 'custom-1',
          name: 'My Writer',
          icon: 'pencil',
          systemMessage: 'You are a creative writing assistant.',
        },
      ],
    });
    useSettingsStore.setState({ personasMigrated: false, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(mockCreateDirectory).toHaveBeenCalledWith('/Users/test/.notesage/agents');

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/Users/test/.notesage/agents/my-writer.md',
      expect.stringContaining('name: "My Writer"'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/Users/test/.notesage/agents/my-writer.md',
      expect.stringContaining('You are a creative writing assistant.'),
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/Users/test/.notesage/agents/my-writer.md',
      expect.stringContaining('icon: "pencil"'),
    );

    expect(useSettingsStore.getState().personasMigrated).toBe(true);
  });

  it('maps built-in persona IDs to bundled agent names', async () => {
    const { setActiveAgent } = setupStoreMocks();

    useAIStore.setState({
      activePersonaId: 'creative',
      customPersonas: [],
    });
    useSettingsStore.setState({ personasMigrated: false, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(setActiveAgent).toHaveBeenCalledWith('creative-writer');
    expect(useSettingsStore.getState().personasMigrated).toBe(true);
  });

  it('maps all built-in persona IDs correctly', async () => {
    // Verify the mapping table entries
    const mappings: [string, string][] = [
      ['general', 'general-assistant'],
      ['creative', 'creative-writer'],
      ['technical', 'technical-editor'],
      ['fact-checker', 'fact-checker'],
      ['academic', 'academic-writer'],
      ['copywriter', 'copywriter'],
      ['proofreader', 'proofreader'],
    ];

    for (const [personaId, expectedAgent] of mappings) {
      vi.clearAllMocks();
      const { setActiveAgent } = setupStoreMocks();

      useAIStore.setState({ activePersonaId: personaId, customPersonas: [] });
      useSettingsStore.setState({ personasMigrated: false, startupReady: true });

      renderHook(() => useSkillDiscovery());

      await act(async () => {
        await new Promise((r) => setTimeout(r, 150));
      });

      expect(setActiveAgent).toHaveBeenCalledWith(expectedAgent);
    }
  });

  it('maps custom persona activePersonaId to slug-based agent name', async () => {
    const { setActiveAgent } = setupStoreMocks();

    useAIStore.setState({
      activePersonaId: 'custom-writer',
      customPersonas: [
        {
          id: 'custom-writer',
          name: 'My Custom Writer',
          icon: 'pen',
          systemMessage: 'Write beautifully.',
        },
      ],
    });
    useSettingsStore.setState({ personasMigrated: false, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(setActiveAgent).toHaveBeenCalledWith('my-custom-writer');
  });

  it('skips migration when personasMigrated is true and no custom personas', async () => {
    setupStoreMocks();

    useAIStore.setState({ activePersonaId: 'general', customPersonas: [] });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockCreateDirectory).not.toHaveBeenCalled();
  });

  it('self-healing: re-creates missing persona files even if flag is set', async () => {
    setupStoreMocks();

    useAIStore.setState({
      activePersonaId: 'general',
      customPersonas: [
        {
          id: 'custom-1',
          name: 'Missing Agent',
          icon: '',
          systemMessage: 'Instructions here.',
        },
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });
    mockPathExists.mockResolvedValue(false);

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/Users/test/.notesage/agents/missing-agent.md',
      expect.stringContaining('Instructions here.'),
    );
  });

  it('does not re-create files that already exist in self-healing check', async () => {
    setupStoreMocks();

    useAIStore.setState({
      activePersonaId: 'general',
      customPersonas: [
        {
          id: 'custom-1',
          name: 'Existing Agent',
          icon: '',
          systemMessage: 'Already there.',
        },
      ],
    });
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });
    mockPathExists.mockResolvedValue(true);

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('does not set activeAgent on re-migration (only first migration)', async () => {
    const { setActiveAgent } = setupStoreMocks();

    useAIStore.setState({
      activePersonaId: 'creative',
      customPersonas: [
        {
          id: 'custom-1',
          name: 'Some Agent',
          icon: '',
          systemMessage: 'test',
        },
      ],
    });
    // personasMigrated=true means it's a re-migration (self-healing),
    // so activeAgent mapping should NOT run
    useSettingsStore.setState({ personasMigrated: true, startupReady: true });
    mockPathExists.mockResolvedValue(false);

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 150));
    });

    // File should be written (self-healing)
    expect(mockWriteFile).toHaveBeenCalled();
    // But setActiveAgent should NOT be called (only on first migration)
    expect(setActiveAgent).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests: useSkillOperations (readSkillContent, readAgentContent, executeScript)
// ---------------------------------------------------------------------------

describe('useSkillOperations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();

    mockReadSkillContent.mockResolvedValue({
      path: '/test/skill',
      readme: '# Test Skill',
      scripts: ['run.sh'],
    });
    mockReadAgentContent.mockResolvedValue({
      path: '/test/agent.md',
      name: 'Test Agent',
      description: 'A test agent',
      instructions: 'Do things',
    });
    mockExecuteSkillScript.mockResolvedValue({
      exitCode: 0,
      stdout: 'script output',
      stderr: '',
    });
  });

  describe('readSkillContent', () => {
    it('delegates to tauriApi.readSkillContent', async () => {
      const { result } = renderHook(() => useSkillOperations());

      let content: unknown;
      await act(async () => {
        content = await result.current.readSkillContent('/path/to/skill');
      });

      expect(mockReadSkillContent).toHaveBeenCalledWith('/path/to/skill');
      expect(content).toEqual({
        path: '/test/skill',
        readme: '# Test Skill',
        scripts: ['run.sh'],
      });
    });

    it('returns a stable reference across renders', () => {
      const { result, rerender } = renderHook(() => useSkillOperations());
      const first = result.current.readSkillContent;
      rerender();
      expect(result.current.readSkillContent).toBe(first);
    });
  });

  describe('readAgentContent', () => {
    it('delegates to tauriApi.readAgentContent', async () => {
      const { result } = renderHook(() => useSkillOperations());

      let content: unknown;
      await act(async () => {
        content = await result.current.readAgentContent('/path/to/agent.md');
      });

      expect(mockReadAgentContent).toHaveBeenCalledWith('/path/to/agent.md');
      expect(content).toEqual({
        path: '/test/agent.md',
        name: 'Test Agent',
        description: 'A test agent',
        instructions: 'Do things',
      });
    });

    it('returns a stable reference across renders', () => {
      const { result, rerender } = renderHook(() => useSkillOperations());
      const first = result.current.readAgentContent;
      rerender();
      expect(result.current.readAgentContent).toBe(first);
    });
  });

  describe('executeScript', () => {
    it('executes script when permission is always-allowed', async () => {
      usePermissionStore.getState().allowSkillScriptAlways('test-skill');

      const { result } = renderHook(() => useSkillOperations());

      let scriptResult: unknown;
      await act(async () => {
        scriptResult = await result.current.executeScript(
          'test-skill',
          '/path/to/skill',
          'run.sh',
          ['--flag'],
          '/working/dir',
        );
      });

      expect(mockExecuteSkillScript).toHaveBeenCalledWith({
        skillPath: '/path/to/skill',
        script: 'run.sh',
        args: ['--flag'],
        workingDir: '/working/dir',
        env: null,
        timeoutMs: null,
      });
      expect(scriptResult).toEqual({
        exitCode: 0,
        stdout: 'script output',
        stderr: '',
      });
    });

    it('executes script when permission is session-allowed', async () => {
      usePermissionStore.getState().allowSkillScriptSession('test-skill');

      const { result } = renderHook(() => useSkillOperations());

      await act(async () => {
        await result.current.executeScript(
          'test-skill',
          '/path/to/skill',
          'run.sh',
        );
      });

      expect(mockExecuteSkillScript).toHaveBeenCalledTimes(1);
    });

    it('throws PERMISSION_REQUIRED when no permission granted', async () => {
      const { result } = renderHook(() => useSkillOperations());

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.executeScript(
            'blocked-skill',
            '/path/to/skill',
            'run.sh',
          );
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error).toBeDefined();
      expect(error!.message).toBe('PERMISSION_REQUIRED:blocked-skill');
      expect(mockExecuteSkillScript).not.toHaveBeenCalled();
    });

    it('passes empty args array by default', async () => {
      usePermissionStore.getState().allowSkillScriptAlways('test-skill');

      const { result } = renderHook(() => useSkillOperations());

      await act(async () => {
        await result.current.executeScript(
          'test-skill',
          '/path/to/skill',
          'run.sh',
        );
      });

      expect(mockExecuteSkillScript).toHaveBeenCalledWith(
        expect.objectContaining({ args: [] }),
      );
    });

    it('passes null workingDir when not specified', async () => {
      usePermissionStore.getState().allowSkillScriptAlways('test-skill');

      const { result } = renderHook(() => useSkillOperations());

      await act(async () => {
        await result.current.executeScript(
          'test-skill',
          '/path/to/skill',
          'run.sh',
        );
      });

      expect(mockExecuteSkillScript).toHaveBeenCalledWith(
        expect.objectContaining({ workingDir: null }),
      );
    });

    it('returns a stable reference across renders', () => {
      const { result, rerender } = renderHook(() => useSkillOperations());
      const first = result.current.executeScript;
      rerender();
      expect(result.current.executeScript).toBe(first);
    });
  });
});
