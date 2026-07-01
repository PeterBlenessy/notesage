// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@/test/tauri-mock';
import { renderHook, act } from '@testing-library/react';
import { useSettingsStore } from '@/stores/settings-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSkillStore } from '@/stores/skill-store';
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
const mockCleanupBundledAgents = vi.fn(async () => 0);
const mockPathExists = vi.fn(async (_path: string) => false);
const mockCreateDirectory = vi.fn(async () => {});
const mockWriteFile = vi.fn(async () => {});
const mockReadSkillContent = vi.fn(async () => ({
  path: '/test/skill',
  readme: '# Skill',
  scripts: [] as string[],
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
// Default skill-script content hash returned by the mocked backend. Tests that
// exercise content-pinning override this per-case.
const mockHashSkillScript = vi.fn(async () => 'HASH1');

vi.mock('@/lib/tauri', () => ({
  tauriApi: {
    getHomeDir: (...args: unknown[]) => (mockGetHomeDir as (...a: unknown[]) => unknown)(...args),
    extractBundledSkills: (...args: unknown[]) => (mockExtractBundledSkills as (...a: unknown[]) => unknown)(...args),
    cleanupBundledAgents: (...args: unknown[]) => (mockCleanupBundledAgents as (...a: unknown[]) => unknown)(...args),
    pathExists: (path: string) => mockPathExists(path),
    createDirectory: (...args: unknown[]) => (mockCreateDirectory as (...a: unknown[]) => unknown)(...args),
    writeFile: (...args: unknown[]) => (mockWriteFile as (...a: unknown[]) => unknown)(...args),
    readSkillContent: (...args: unknown[]) => (mockReadSkillContent as (...a: unknown[]) => unknown)(...args),
    readAgentContent: (...args: unknown[]) => (mockReadAgentContent as (...a: unknown[]) => unknown)(...args),
    executeSkillScript: (...args: unknown[]) => (mockExecuteSkillScript as (...a: unknown[]) => unknown)(...args),
    hashSkillScript: (...args: unknown[]) => (mockHashSkillScript as (...a: unknown[]) => unknown)(...args),
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
    homeDir: '/Users/test',
    skillsReady: false,
    startupReady: false,
    bundledAgentsCleaned: true, // Default to true to skip cleanup unless testing it
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
    activeAgentName: '',
    enabledOverrides: {},
    agentEnabledOverrides: {},
  });
  usePermissionStore.setState({
    skillScriptSession: new Set<string>(),
    skillScriptAlways: [],
  });
}

/** Set up store spy methods for skill/agent scanning. */
function setupStoreMocks() {
  const scanSkills = vi.fn(async (..._args: unknown[]) => {});
  const scanAgents = vi.fn(async (..._args: unknown[]) => {});
  const scanAgentInstructions = vi.fn(async (..._args: unknown[]) => {});
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

/**
 * Flatten the current scan argument (either legacy flat array or per-project
 * `{ globalDirs, byProject }` form) to a flat list of dirs for assertion.
 */
function flattenScanArg(arg: unknown): string[] {
  if (Array.isArray(arg)) return arg;
  if (arg && typeof arg === 'object') {
    const { globalDirs = [], byProject = {} } = arg as {
      globalDirs?: string[];
      byProject?: Record<string, string[]>;
    };
    return [...globalDirs, ...Object.values(byProject).flat()];
  }
  return [];
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
    mockCleanupBundledAgents.mockResolvedValue(0);
    mockPathExists.mockResolvedValue(false);
    mockCreateDirectory.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('does not run when skillsReady is false', async () => {
    useSettingsStore.setState({ skillsReady: false });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(mockExtractBundledSkills).not.toHaveBeenCalled();
  });

  // This MUST be the first test that sets skillsReady=true so bundledExtracted
  // is still false and extraction runs.
  it('runs full discovery pipeline including extraction on first run', async () => {
    const { scanSkills, scanAgents, scanAgentInstructions } = setupStoreMocks();
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Bundled skills extraction should run on first invocation (phase 2)
    expect(mockExtractBundledSkills).toHaveBeenCalledTimes(1);
    // scanSkills/scanAgents called twice: phase 1 (immediate) + phase 2 (after extraction)
    expect(scanSkills).toHaveBeenCalledTimes(2);
    expect(scanAgents).toHaveBeenCalledTimes(2);
    expect(scanAgentInstructions).toHaveBeenCalledTimes(1);
  });

  // After the first test, bundledExtracted is true. Subsequent runs skip extraction.
  it('skips extraction on subsequent runs (bundledExtracted flag)', async () => {
    const { scanSkills, scanAgents } = setupStoreMocks();
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Extraction NOT called (bundledExtracted already true from previous test)
    expect(mockExtractBundledSkills).not.toHaveBeenCalled();
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
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = flattenScanArg(scanSkills.mock.calls[0][0]);
    expect(skillDirs).toContain('/Users/test/.notesage/skills');
    expect(skillDirs).toContain('/projects/alpha/.notesage/skills');
    expect(skillDirs).toContain('/projects/beta/.notesage/skills');

    const agentDirs = flattenScanArg(scanAgents.mock.calls[0][0]);
    expect(agentDirs).toContain('/Users/test/.notesage/agents');
    expect(agentDirs).toContain('/projects/alpha/.notesage/agents');
    expect(agentDirs).toContain('/projects/beta/.notesage/agents');
    expect(agentDirs).toContain('/projects/alpha/.github/agents');
    expect(agentDirs).toContain('/projects/beta/.github/agents');

    // Per-project isolation: project dirs bucketed by projectRoot (Task #18)
    const skillArg = scanSkills.mock.calls[0][0] as { byProject?: Record<string, string[]> };
    expect(skillArg.byProject?.['/projects/alpha']).toContain('/projects/alpha/.notesage/skills');
    expect(skillArg.byProject?.['/projects/beta']).toContain('/projects/beta/.notesage/skills');
  });

  it('includes provider-specific paths for agent_managed connections', async () => {
    const { scanSkills, scanAgents } = setupStoreMocks();

    useConnectionsStore.setState({
      connections: [
        makeAgentManagedConnection('anthropic'),
        makeAgentManagedConnection('openai', { id: 'conn-openai' }),
      ],
    });
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = flattenScanArg(scanSkills.mock.calls[0][0]);
    expect(skillDirs).toContain('/Users/test/.claude/skills');
    expect(skillDirs).toContain('/Users/test/.codex/skills');

    const agentDirs = flattenScanArg(scanAgents.mock.calls[0][0]);
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
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = flattenScanArg(scanSkills.mock.calls[0][0]);
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
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = flattenScanArg(scanSkills.mock.calls[0][0]);
    const geminiCount = skillDirs.filter((d) => d === '/Users/test/.gemini/skills').length;
    expect(geminiCount).toBe(1);
  });

  it('includes Copilot agent paths for non-agent_managed github connections', async () => {
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
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const agentDirs = flattenScanArg(scanAgents.mock.calls[0][0]);
    expect(agentDirs).toContain('/Users/test/.copilot/agents');
  });

  it('handles home directory failure gracefully', async () => {
    const { scanSkills } = setupStoreMocks();
    useSettingsStore.setState({ homeDir: null, skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Should abort without calling scanSkills
    expect(scanSkills).not.toHaveBeenCalled();
  });

  it('rescans when rescanCounter changes', async () => {
    const { scanSkills } = setupStoreMocks();
    useSettingsStore.setState({ skillsReady: true });

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

  // Task #19 — scanAgentInstructions now accepts an ARRAY of project roots so
  // each project's CLAUDE.md / AGENTS.md is discovered and stored with its
  // projectRoot annotation. The scoped getters then filter by
  // `selectedProjectPaths` so project A's CLAUDE.md doesn't leak into project B.
  it('passes ALL known project roots and provider types to scanAgentInstructions (Task #19)', async () => {
    const { scanAgentInstructions } = setupStoreMocks();

    useWorkspaceStore.setState({
      projects: [
        { path: '/projects/first', fileTree: [] },
        { path: '/projects/second', fileTree: [] },
      ],
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
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    expect(scanAgentInstructions).toHaveBeenCalledWith(
      expect.arrayContaining(['/projects/first', '/projects/second']),
      expect.arrayContaining(['claude-code', 'gemini']),
    );

    // Regression lock for Task #19 — the old behaviour called with `projects[0]`
    // alone, silently dropping project B's instructions. Ensure we never revert.
    const callArgs = (scanAgentInstructions.mock.calls as unknown as [string[], string[]][])[0];
    expect(Array.isArray(callArgs[0])).toBe(true);
    expect(callArgs[0]).toHaveLength(2);
  });

  it('skips disconnected connections for provider paths', async () => {
    const { scanSkills } = setupStoreMocks();

    useConnectionsStore.setState({
      connections: [
        makeAgentManagedConnection('anthropic', { status: 'disconnected' as Connection['status'] }),
      ],
    });
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const skillDirs = (scanSkills.mock.calls as unknown as [string[]][])[0][0];
    // Should not include provider paths for disconnected connections
    expect(skillDirs).not.toContain('/Users/test/.claude/skills');
  });
});

// ---------------------------------------------------------------------------
// Tests: project-level agent discovery directories
// ---------------------------------------------------------------------------

describe('project-level agent discovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    mockGetHomeDir.mockResolvedValue('/Users/test');
    mockExtractBundledSkills.mockResolvedValue('/Users/test/.notesage/bundled-skills');
    mockCleanupBundledAgents.mockResolvedValue(0);
  });

  it('includes .claude/agents/ and .gemini/agents/ for each project', async () => {
    const { scanAgents } = setupStoreMocks();

    useWorkspaceStore.setState({
      projects: [{ path: '/projects/myapp', fileTree: [] }],
    });
    useSettingsStore.setState({ skillsReady: true });

    renderHook(() => useSkillDiscovery());

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const agentDirs = flattenScanArg(scanAgents.mock.calls[0][0]);
    expect(agentDirs).toContain('/projects/myapp/.claude/agents');
    expect(agentDirs).toContain('/projects/myapp/.gemini/agents');
    expect(agentDirs).toContain('/projects/myapp/.notesage/agents');
    expect(agentDirs).toContain('/projects/myapp/.github/agents');

    // Per-project isolation: bucketed under the project root so
    // `scanAgents` store action can annotate entries with projectRoot (Task #18).
    const arg = scanAgents.mock.calls[0][0] as { byProject?: Record<string, string[]> };
    expect(arg.byProject?.['/projects/myapp']).toEqual(
      expect.arrayContaining([
        '/projects/myapp/.notesage/agents',
        '/projects/myapp/.github/agents',
        '/projects/myapp/.claude/agents',
        '/projects/myapp/.gemini/agents',
      ]),
    );
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
    it('executes script when permission is always-allowed (content-pinned)', async () => {
      // Pin the approval to the same hash the backend will report for the body.
      mockHashSkillScript.mockResolvedValueOnce('HASH1');
      usePermissionStore.getState().allowSkillScriptAlways('test-skill', null, null, 'HASH1');

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
        expectedHash: 'HASH1',
      });
      expect(scriptResult).toEqual({
        exitCode: 0,
        stdout: 'script output',
        stderr: '',
      });
    });

    it('re-prompts (PERMISSION_REQUIRED) when the script body changed since approval', async () => {
      // User approved the OLD body; the script has since been rewritten so the
      // backend now reports a different hash. The stale "allow always" must NOT
      // auto-approve (security audit HIGH #2).
      usePermissionStore.getState().allowSkillScriptAlways('test-skill', null, null, 'OLD_HASH');
      mockHashSkillScript.mockResolvedValueOnce('NEW_HASH');

      const { result } = renderHook(() => useSkillOperations());

      let error: Error | undefined;
      await act(async () => {
        try {
          await result.current.executeScript('test-skill', '/path/to/skill', 'run.sh');
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error?.message).toBe('PERMISSION_REQUIRED:test-skill');
      expect(mockExecuteSkillScript).not.toHaveBeenCalled();
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
      usePermissionStore.getState().allowSkillScriptAlways('test-skill', null, null, 'HASH1');

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
      usePermissionStore.getState().allowSkillScriptAlways('test-skill', null, null, 'HASH1');

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
