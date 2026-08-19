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
import type { FileEntry } from '@/lib/tauri';

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
  useEditorStore.setState({ openDocuments: [], activeTabId: null });
  useSettingsStore.setState({ notesRootPath: '', homeDir: null });
}

function seedActiveTab(filePath: string, fileName: string) {
  useEditorStore.setState({
    openDocuments: [
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

// ---------------------------------------------------------------------------
// Task #27 — file-tree system-prompt injection scope + caps
// ---------------------------------------------------------------------------

function file(path: string, name?: string): FileEntry {
  return {
    name: name ?? path.split('/').pop()!,
    path,
    is_directory: false,
    hidden: false,
  };
}

function dir(path: string, children: FileEntry[], name?: string): FileEntry {
  return {
    name: name ?? path.split('/').pop()!,
    path,
    is_directory: true,
    children,
    hidden: false,
  };
}

/** Build a flat 500-file directory at the given root path. */
function flatProject(rootPath: string, fileCount: number): FileEntry[] {
  const children: FileEntry[] = [];
  for (let i = 0; i < fileCount; i++) {
    children.push(file(`${rootPath}/file-${i}.md`));
  }
  return children;
}

/** Build a chain of nested directories `N` deep, each containing a leaf file. */
function deepChain(rootPath: string, levels: number): FileEntry[] {
  // Top-level dir d1 → d2 → ... → dN → leaf.md
  let innerPath = `${rootPath}/${Array.from({ length: levels }, (_, i) => `d${i + 1}`).join('/')}`;
  let inner: FileEntry[] = [file(`${innerPath}/leaf.md`)];
  for (let i = levels; i >= 1; i--) {
    innerPath = `${rootPath}/${Array.from({ length: i }, (_, j) => `d${j + 1}`).join('/')}`;
    inner = [dir(innerPath, inner)];
  }
  return inner;
}

describe('useAIContext — file-tree injection scope (Task #27)', () => {
  beforeEach(() => {
    resetAll();
  });

  it('does NOT leak Project B filenames when only Project A is selected', () => {
    // Attack: workspace-store contains BOTH projects. Chat scoped to A only.
    // Pre-fix observation: without the scope filter a refactor could
    // accidentally walk every project. Post-fix: only project-A's entries
    // appear in the composed system message.
    useWorkspaceStore.setState({
      projects: [
        {
          path: '/workspace/project-A',
          fileTree: [
            file('/workspace/project-A/alpha-notes.md'),
            file('/workspace/project-A/alpha-ideas.md'),
          ],
        },
        {
          path: '/workspace/project-B',
          fileTree: [
            file('/workspace/project-B/beta-secrets.md'),
            file('/workspace/project-B/beta-client-list.md'),
          ],
        },
      ],
      explorerFolders: [
        {
          path: '/somewhere/else',
          fileTree: [file('/somewhere/else/explorer-file.md')],
        },
      ],
    });
    seedActiveConversation(['/workspace/project-A']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).toContain('alpha-notes.md');
    expect(msg).toContain('alpha-ideas.md');
    expect(msg).not.toContain('beta-secrets.md');
    expect(msg).not.toContain('beta-client-list.md');
    expect(msg).not.toContain('explorer-file.md');
  });

  it('includes files under the notes root when that is the entry-point scope', () => {
    // Consistent with #8 / #16 / #17 / #23 — notes root is always in-scope.
    useSettingsStore.setState({ notesRootPath: '/Users/me/Notesage', homeDir: '/Users/me' });
    useWorkspaceStore.setState({
      projects: [
        {
          path: '/Users/me/Notesage',
          fileTree: [
            file('/Users/me/Notesage/welcome.md'),
            file('/Users/me/Notesage/journal.md'),
          ],
        },
      ],
    });
    seedActiveConversation(['/Users/me/Notesage']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).toContain('welcome.md');
    expect(msg).toContain('journal.md');
  });

  it('truncates the tree to 200 entries for a 500-file project', () => {
    useWorkspaceStore.setState({
      projects: [
        {
          path: '/workspace/big-project',
          fileTree: flatProject('/workspace/big-project', 500),
        },
      ],
    });
    seedActiveConversation(['/workspace/big-project']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    // file-0.md through file-199.md should appear; file-200.md should not.
    expect(msg).toContain('file-0.md');
    expect(msg).toContain('file-199.md');
    expect(msg).not.toContain('file-200.md');
    expect(msg).toContain('(truncated)');

    // Count "file-<digits>" entries to prove the cap is respected.
    const matches = msg.match(/file-\d+\.md/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(200);
  });

  it('caps depth at 4 directory levels (deeper paths truncated)', () => {
    // deepChain with 6 levels: rootPath / d1 / d2 / d3 / d4 / d5 / d6 / leaf.md
    // Depth 0 = d1, depth 1 = d2, ..., depth 5 = d6. With maxLevels=4 the
    // walker stops before descending into d5 — so d5, d6, and leaf.md do
    // NOT appear in the injected tree.
    useWorkspaceStore.setState({
      projects: [
        {
          path: '/workspace/deep-project',
          fileTree: deepChain('/workspace/deep-project', 6),
        },
      ],
    });
    seedActiveConversation(['/workspace/deep-project']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).toContain('d1/');
    expect(msg).toContain('d2/');
    expect(msg).toContain('d3/');
    expect(msg).toContain('d4/');
    expect(msg).not.toContain('d5/');
    expect(msg).not.toContain('d6/');
    expect(msg).not.toContain('leaf.md');
  });

  it('does not inject a file tree when no project is selected (scope stays closed)', () => {
    // Empty scope must not fall through to "show all projects" (the bug the
    // task is closing). Even if the workspace has 3 projects loaded, an
    // unscoped conversation sees none of their filenames.
    useWorkspaceStore.setState({
      projects: [
        {
          path: '/workspace/project-A',
          fileTree: [file('/workspace/project-A/alpha.md')],
        },
        {
          path: '/workspace/project-B',
          fileTree: [file('/workspace/project-B/beta.md')],
        },
      ],
    });
    seedActiveConversation([]);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).not.toContain('alpha.md');
    expect(msg).not.toContain('beta.md');
    expect(msg).not.toContain('## Project Files');
  });
});

describe('useAIContext — ReAct guidance in localSystemMessage', () => {
  beforeEach(() => {
    resetAll();
  });

  it('includes the tool-use protocol when tool calling is enabled (default)', () => {
    // Set explicitly rather than relying on the default. `toolCallingEnabled`
    // is shared module state and `useDirectApiChat.test.ts` sets it false — so
    // "the default" is whatever the previous FILE left behind, and this test
    // failed or passed depending on suite order.
    useSettingsStore.setState({ toolCallingEnabled: true });
    seedActiveConversation(['/projects/A']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.localSystemMessage;

    expect(msg).toMatch(/Tool use protocol/i);
    expect(msg).toMatch(/before each tool call/i);
    expect(msg).toMatch(/after each result/i);
  });

  it('omits the protocol when tool calling is disabled', () => {
    // Wasting tokens on guidance for a feature the model can't reach is
    // the failure mode this gate exists to prevent.
    useSettingsStore.setState({ toolCallingEnabled: false });
    seedActiveConversation(['/projects/A']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.localSystemMessage;

    expect(msg).not.toMatch(/Tool use protocol/i);
  });

  it('does not bleed the protocol into the composed (direct API) system message', () => {
    // composedSystemMessage feeds Anthropic / OpenAI / Ollama / openai_compatible.
    // ReAct guidance is only valuable for local-tier models and would just
    // burn tokens on frontier ones, so it must stay local-only.
    seedActiveConversation(['/projects/A']);

    const { result } = renderHook(() => useAIContext());
    const msg = result.current.composedSystemMessage;

    expect(msg).not.toMatch(/Tool use protocol/i);
  });
});
