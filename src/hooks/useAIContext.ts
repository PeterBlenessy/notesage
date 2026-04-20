import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSkillStore } from '@/stores/skill-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { buildGoalsContext, buildProjectHeader, buildFileTreeContext } from '@/lib/ai/context';
import { isUriInScope, type UriScope } from '@/lib/ai/uri-scope';
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Hook — builds all AI system messages and context
// ---------------------------------------------------------------------------

export interface UseAIContextReturn {
  composedSystemMessage: string;
  localSystemMessage: string;
  acpSystemMessage: string;
  buildComposedSystemMessage: (attachedFilePaths?: string[]) => string;
  buildAcpSystemMessage: (attachedFilePaths?: string[]) => string;
}

export function useAIContext(): UseAIContextReturn {
  const selectedProjectPaths = useChatStore(selectProjectPaths);
  const metadataMap = useProjectMetadataStore((s) => s.metadataMap);

  // Derive single-project values
  const singleProjectPath = selectedProjectPaths.length === 1 ? selectedProjectPaths[0] : null;
  const singleMetadata = singleProjectPath ? metadataMap[singleProjectPath] ?? null : null;

  // Active agent body — loaded from disk
  const activeAgent = useSkillStore((s) => s.getActiveAgent());
  interface AgentBodyState { name: string; body: string }
  const [agentBody, setAgentBody] = useState<AgentBodyState>({ name: '', body: '' });

  useEffect(() => {
    const agentName = activeAgent?.name ?? '';
    if (!activeAgent || !agentName) {
      setAgentBody({ name: '', body: '' });
      return;
    }
    if (agentBody.name === agentName) return;

    let cancelled = false;
    invoke<{ name: string; body: string; path: string }>('read_agent_content', { agentPath: activeAgent.path })
      .then((content) => { if (!cancelled) setAgentBody({ name: agentName, body: content.body }); })
      .catch(() => { if (!cancelled) setAgentBody({ name: agentName, body: '' }); }); // Expected: agent file may not exist or be unreadable — fall back to empty body
    return () => { cancelled = true; };
  }, [activeAgent?.name, activeAgent?.path, agentBody.name]);

  const agentSystemMessage = agentBody.body || 'You are a helpful writing assistant.';

  // Discover goal files (only when exactly one project is selected)
  const { goalFiles } = useGoalsDiscovery(singleProjectPath);
  const goalsContext = useMemo(() => buildGoalsContext(goalFiles), [goalFiles]);

  // Project file tree for single-project context
  const singleProject = useWorkspaceStore((s) =>
    singleProjectPath ? s.projects.find((p) => p.path === singleProjectPath) : undefined
  );

  // Active file for file awareness
  const activeTab = useEditorStore((s) => {
    if (!s.activeTabId) return null;
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });

  // Task #23 — the active tab's path may only be included in the system
  // prompt / local-model context when it lives inside the scoped projects
  // (or the notes root). Otherwise we would leak out-of-scope file paths
  // into a conversation that's meant to be restricted (same policy as #8,
  // #16, #17, #18). Consumers of `useChatContext` that explicitly opt in
  // via `attachExplicit` feed their chosen path through `attachedFilePaths`
  // instead — that path stays honoured regardless of scope because it's a
  // user-initiated attachment.
  const notesRootPath = useSettingsStore((s) => s.notesRootPath);
  const homeDir = useSettingsStore((s) => s.homeDir);
  const resolvedNotesRoot = useMemo(() => {
    if (!notesRootPath) return null;
    if (notesRootPath.startsWith('~')) {
      return homeDir ? notesRootPath.replace('~', homeDir) : null;
    }
    return notesRootPath;
  }, [notesRootPath, homeDir]);
  const activeTabInScope = useMemo(() => {
    if (!activeTab?.filePath) return false;
    const scope: UriScope = {
      projectRoots: selectedProjectPaths,
      notesRootPath: resolvedNotesRoot,
    };
    return isUriInScope(activeTab.filePath, scope);
  }, [activeTab?.filePath, selectedProjectPaths, resolvedNotesRoot]);

  // Skill context for AI prompts — scoped to the active conversation's
  // project selection so Project A's skills/instructions do not leak into a
  // chat that has only Project B selected (Task #18 isolation). Global
  // (~/.notesage/) skills and instructions are always included.
  const skillDescriptions = useSkillStore((s) => s.getSkillDescriptionsForPrompt(selectedProjectPaths));
  const notesageSkillDescriptions = useSkillStore((s) => s.getNotesageSkillDescriptionsForPrompt(selectedProjectPaths));
  const agentInstructions = useSkillStore((s) => s.getMergedAgentInstructions(selectedProjectPaths));
  const notesageAgentInstructions = useSkillStore((s) => s.getNotesageAgentInstructions(selectedProjectPaths));

  // Shared project/goals/file-tree context builder
  const buildProjectContext = useCallback((attachedFilePaths?: string[]): string[] => {
    const parts: string[] = [];

    if (selectedProjectPaths.length === 1) {
      if (singleMetadata) {
        const header = buildProjectHeader(singleMetadata, singleProjectPath!);
        if (header) parts.push(header);
      } else if (singleProjectPath) {
        parts.push(`Project root: ${singleProjectPath}`);
      }
      if (goalsContext) parts.push(goalsContext);
      if (singleProject?.fileTree) {
        // Task #27 — scope the file-tree injection to the selected project
        // and the notes root, and cap it at 200 files / 4 levels. The call
        // site already limits to `singleProject` (lookup by path in the
        // workspace store), but we pass a scope filter to `buildFileTreeContext`
        // as defense-in-depth so a future refactor can't reintroduce the leak.
        const scope: UriScope = {
          projectRoots: selectedProjectPaths,
          notesRootPath: resolvedNotesRoot,
        };
        const treeContext = buildFileTreeContext(singleProject.fileTree, singleProjectPath!, { scope });
        if (treeContext) parts.push(treeContext);
      }
    } else if (selectedProjectPaths.length > 1) {
      const summaries: string[] = [];
      for (const path of selectedProjectPaths) {
        const meta = metadataMap[path];
        if (meta) {
          summaries.push(buildProjectHeader(meta, path));
        } else {
          const name = path.split('/').pop() || path;
          summaries.push(`Project: ${name}\nProject root: ${path}`);
        }
      }
      parts.push(`The user has the following projects selected:\n\n${summaries.join('\n\n')}`);
    }

    // Attach file paths from context pills (or fall back to active tab for non-chat callers).
    // The fallback is scope-gated (task #23) — a non-chat caller (generateText, bubble
    // menu) should not splice an out-of-scope file path into the prompt just because
    // the user happens to have that tab active.
    if (attachedFilePaths && attachedFilePaths.length > 0) {
      for (const filePath of attachedFilePaths) {
        parts.push(`File in context: ${filePath}`);
      }
    } else if (!attachedFilePaths && activeTab && activeTabInScope) {
      parts.push(`Currently editing: ${activeTab.filePath}`);
    }

    return parts;
  }, [selectedProjectPaths, singleProjectPath, singleMetadata, goalsContext, singleProject, activeTab, activeTabInScope, metadataMap, resolvedNotesRoot]);

  // Compose system message for direct API providers
  const buildComposedSystemMessage = useCallback((attachedFilePaths?: string[]) => {
    const parts = buildProjectContext(attachedFilePaths);
    if (agentInstructions) parts.push(agentInstructions);
    if (agentSystemMessage) parts.unshift(agentSystemMessage);
    if (skillDescriptions) parts.push(skillDescriptions);
    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, agentSystemMessage, agentInstructions, skillDescriptions]);

  // Memoized version for non-chat callers (generateText, bubble menu actions)
  const composedSystemMessage = useMemo(() => buildComposedSystemMessage(), [buildComposedSystemMessage]);

  // System message for local models — minimal context, tools handle discovery.
  // Only provides the project root and active file. The model uses list_directory
  // to explore files on demand rather than front-loading the entire tree.
  const localSystemMessage = useMemo(() => {
    const parts: string[] = [];
    parts.push(agentSystemMessage || 'You are a helpful writing assistant. Be concise and focused.');

    // Project root(s) — just the path, no file tree
    if (selectedProjectPaths.length === 1) {
      if (singleMetadata) {
        parts.push(`Project: ${singleMetadata.name}\nProject root: ${singleProjectPath}`);
      } else if (singleProjectPath) {
        parts.push(`Project root: ${singleProjectPath}`);
      }
    } else if (selectedProjectPaths.length > 1) {
      const roots = selectedProjectPaths.map((p) => {
        const meta = metadataMap[p];
        return meta ? `${meta.name}: ${p}` : p;
      });
      parts.push(`Projects:\n${roots.join('\n')}`);
    }

    // Active file — task #23: only include when in scope. Local models
    // otherwise see a "Currently editing" line pointing at a file they have
    // no sanctioned way to touch, which both leaks the path and invites the
    // model to attempt out-of-scope reads.
    if (activeTab && activeTabInScope) {
      parts.push(`Currently editing: ${activeTab.filePath}`);
    }

    // Tool guidance
    parts.push('You have tools to read files, write files, and list directories. Use list_directory to discover files before reading them. Always use absolute paths. Start from the project root above.');

    return parts.join('\n\n');
  }, [agentSystemMessage, selectedProjectPaths, singleProjectPath, singleMetadata, activeTab, activeTabInScope, metadataMap]);

  // ACP-specific system message builder — no agent role injection;
  // ACP agents manage their own subagent system via @agent-name pass-through.
  const buildAcpSystemMessage = useCallback((attachedFilePaths?: string[]) => {
    const parts = buildProjectContext(attachedFilePaths);
    if (notesageAgentInstructions) parts.push(notesageAgentInstructions);
    if (notesageSkillDescriptions) parts.push(notesageSkillDescriptions);
    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, notesageAgentInstructions, notesageSkillDescriptions]);

  // Memoized version for ACP lifecycle hook
  const acpSystemMessage = useMemo(() => buildAcpSystemMessage(), [buildAcpSystemMessage]);

  return {
    composedSystemMessage,
    localSystemMessage,
    acpSystemMessage,
    buildComposedSystemMessage,
    buildAcpSystemMessage,
  };
}
