// @vitest-environment jsdom
//
// Task #18 / #19 — red-team isolation tests for useAIContext.
//
// These tests codify the security invariant: skills, agents, and instructions
// scoped to Project A MUST NOT appear in the system prompt of a chat whose
// active conversation selects only Project B. Global entries are always
// included. Tests walk through the composed/acp/local system-message builders.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@/test/tauri-mock';
import { renderHook } from '@testing-library/react';

vi.mock('@/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// goals discovery is noise for these tests
vi.mock('@/hooks/useGoalsDiscovery', () => ({
  useGoalsDiscovery: () => ({ goalFiles: [] }),
}));

import { useSkillStore } from '@/stores/skill-store';
import { useChatStore } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useAIContext } from '@/hooks/useAIContext';
import type { SkillEntry, AgentInstruction } from '@/stores/skill-store';

function skillEntry(overrides: Partial<SkillEntry> & { name: string; source: string }): SkillEntry {
  return {
    description: overrides.description ?? overrides.name,
    path: overrides.path ?? `/skills/${overrides.source}/${overrides.name}`,
    has_scripts: false,
    has_references: false,
    ...overrides,
  };
}

function instructionEntry(
  overrides: Partial<AgentInstruction> & { source_type: string; priority: number; content: string },
): AgentInstruction {
  return {
    source: overrides.source ?? `/path/${overrides.source_type}`,
    ...overrides,
  };
}

function seedActiveConversation(projectPaths: string[]) {
  const conv = {
    id: 'conv-test',
    title: 'Test',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    projectPaths,
    segments: [],
    activeSegmentIndex: 0,
    pendingProjectSwitch: null,
    activeLeafId: null,
  };
  useChatStore.setState({
    conversations: [conv],
    activeConversationId: 'conv-test',
  });
}

function resetAll() {
  useSkillStore.setState({
    skills: [],
    agents: [],
    agentInstructions: [],
    skillTools: [],
    activeAgentName: '',
    enabledOverrides: {},
    agentEnabledOverrides: {},
  });
  useProjectMetadataStore.setState({ metadataMap: {} });
  useWorkspaceStore.setState({ projects: [], explorerFolders: [] });
  useEditorStore.setState({ tabs: [], activeTabId: null });
  useSettingsStore.setState({ notesRootPath: '', homeDir: null });
}

function seedActiveTab(filePath: string, fileName: string) {
  useEditorStore.setState({
    tabs: [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'tab-1', filePath, fileName, content: '', originalContent: '', dirty: false } as any,
    ],
    activeTabId: 'tab-1',
  });
}

describe('useAIContext — per-project isolation (Task #18)', () => {
  beforeEach(() => {
    resetAll();
  });

  it('does NOT leak Project A skill into system prompt when only Project B is selected', () => {
    useSkillStore.setState({
      skills: [
        skillEntry({ name: 'alpha-secret', source: 'notesage-project', projectRoot: '/projects/A', description: 'A secret' }),
        skillEntry({ name: 'beta-public', source: 'notesage-project', projectRoot: '/projects/B', description: 'B skill' }),
        skillEntry({ name: 'world-skill', source: 'notesage-global', description: 'Global skill' }),
      ],
    });
    seedActiveConversation(['/projects/B']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).not.toContain('alpha-secret');
    expect(msg).toContain('beta-public');
    expect(msg).toContain('world-skill');
  });

  it('does NOT leak Project A agent instructions (CLAUDE.md etc.) into Project B chat', () => {
    useSkillStore.setState({
      agentInstructions: [
        instructionEntry({ source_type: 'claude-md', priority: 2, projectRoot: '/projects/A', content: 'ALPHA_CLAUDE_MD' }),
        instructionEntry({ source_type: 'claude-md', priority: 2, projectRoot: '/projects/B', content: 'BETA_CLAUDE_MD' }),
        instructionEntry({ source_type: 'notesage-global', priority: 4, content: 'GLOBAL_RULES' }),
      ],
    });
    seedActiveConversation(['/projects/B']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).not.toContain('ALPHA_CLAUDE_MD');
    expect(msg).toContain('BETA_CLAUDE_MD');
    expect(msg).toContain('GLOBAL_RULES');
  });

  it('ACP system message respects scope (notesage-only variant)', () => {
    useSkillStore.setState({
      skills: [
        skillEntry({ name: 'a-only', source: 'notesage-project', projectRoot: '/projects/A', description: 'Scoped A' }),
        skillEntry({ name: 'b-only', source: 'notesage-project', projectRoot: '/projects/B', description: 'Scoped B' }),
      ],
      agentInstructions: [
        instructionEntry({ source_type: 'notesage-project', priority: 5, projectRoot: '/projects/A', content: 'ALPHA_NOTESAGE_RULES' }),
        instructionEntry({ source_type: 'notesage-project', priority: 5, projectRoot: '/projects/B', content: 'BETA_NOTESAGE_RULES' }),
      ],
    });
    seedActiveConversation(['/projects/B']);

    const { result } = renderHook(() => useAIContext());
    const acp = result.current.acpSystemMessage;

    expect(acp).not.toContain('a-only');
    expect(acp).toContain('b-only');
    expect(acp).not.toContain('ALPHA_NOTESAGE_RULES');
    expect(acp).toContain('BETA_NOTESAGE_RULES');
  });

  it('multi-select includes skills from all selected projects (and no others)', () => {
    useSkillStore.setState({
      skills: [
        skillEntry({ name: 'a-skill', source: 'notesage-project', projectRoot: '/projects/A' }),
        skillEntry({ name: 'b-skill', source: 'notesage-project', projectRoot: '/projects/B' }),
        skillEntry({ name: 'c-skill', source: 'notesage-project', projectRoot: '/projects/C' }),
      ],
    });
    seedActiveConversation(['/projects/A', '/projects/B']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).toContain('a-skill');
    expect(msg).toContain('b-skill');
    expect(msg).not.toContain('c-skill');
  });

  it('does NOT include "Currently editing" for an out-of-scope active tab (Task #23)', () => {
    // Red-team seed: editor has Project B's file open, chat scoped to A.
    // Pre-fix: localSystemMessage unconditionally appended
    // `Currently editing: /workspace/project-B/secrets.md`.
    seedActiveTab('/workspace/project-B/secrets.md', 'secrets.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useAIContext());

    expect(result.current.localSystemMessage).not.toContain('/workspace/project-B/secrets.md');
    // Composed (direct API) path via buildComposedSystemMessage() with no
    // attachments also used to splice in the active tab path.
    expect(result.current.composedSystemMessage).not.toContain('/workspace/project-B/secrets.md');
  });

  it('DOES include "Currently editing" for an in-scope active tab', () => {
    seedActiveTab('/workspace/project-A/notes.md', 'notes.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useAIContext());

    expect(result.current.localSystemMessage).toContain('/workspace/project-A/notes.md');
    expect(result.current.composedSystemMessage).toContain('/workspace/project-A/notes.md');
  });

  it('tab under the notes root is considered in scope (matches #16/#17)', () => {
    useSettingsStore.setState({ notesRootPath: '~/Notesage', homeDir: '/Users/me' });
    seedActiveTab('/Users/me/Notesage/thought.md', 'thought.md');
    seedActiveConversation([]);

    const { result } = renderHook(() => useAIContext());

    expect(result.current.localSystemMessage).toContain('/Users/me/Notesage/thought.md');
  });

  it('empty scope + tab not under notes root → no "Currently editing" leak', () => {
    seedActiveTab('/tmp/stray.md', 'stray.md');
    seedActiveConversation([]);

    const { result } = renderHook(() => useAIContext());

    expect(result.current.localSystemMessage).not.toContain('/tmp/stray.md');
    expect(result.current.composedSystemMessage).not.toContain('/tmp/stray.md');
  });

  it('an explicit attachedFilePaths entry is honoured regardless of scope', () => {
    // User explicitly opted in via the "Add to chat" button (task #23 UX).
    // The explicit attach must be respected even if the path is out-of-scope.
    seedActiveTab('/workspace/project-A/notes.md', 'notes.md');
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.buildComposedSystemMessage(['/workspace/project-B/secrets.md']);

    expect(msg).toContain('File in context: /workspace/project-B/secrets.md');
  });

  it('empty conversation scope exposes only global skills (no project leaks)', () => {
    useSkillStore.setState({
      skills: [
        skillEntry({ name: 'world', source: 'notesage-global', description: 'Global' }),
        skillEntry({ name: 'leaky', source: 'notesage-project', projectRoot: '/projects/A' }),
      ],
    });
    seedActiveConversation([]);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).toContain('world');
    expect(msg).not.toContain('leaky');
  });
});
