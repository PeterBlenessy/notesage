import { useCallback, useEffect, useMemo, useState } from 'react';
import { useChatStore, selectProjectPaths } from '@/stores/chat-store';
import { useProjectMetadataStore } from '@/stores/project-metadata-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useEditorStore } from '@/stores/editor-store';
import { useSkillStore } from '@/stores/skill-store';
import { useGoalsDiscovery } from '@/hooks/useGoalsDiscovery';
import { buildGoalsContext, buildProjectHeader, buildFileTreeContext } from '@/lib/ai/context';
import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Hook — builds all AI system messages and context
// ---------------------------------------------------------------------------

export function useAIContext() {
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
      .catch(() => { if (!cancelled) setAgentBody({ name: agentName, body: '' }); });
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

  // Skill context for AI prompts — filtered by active agent's allowed-tools
  const agentAllowedTools = activeAgent?.allowed_tools;
  const skillDescriptions = useSkillStore((s) => {
    const desc = s.getSkillDescriptionsForPrompt();
    if (!agentAllowedTools || agentAllowedTools.length === 0) return desc;
    const active = s.getActiveSkills().filter((sk) => agentAllowedTools.includes(sk.name));
    if (active.length === 0) return '';
    const lines = active.map((sk) => `- **${sk.name}**: ${sk.description}${sk.has_scripts ? ' (has scripts)' : ''}`);
    return `\n\nAvailable skills:\n${lines.join('\n')}`;
  });
  const notesageSkillDescriptions = useSkillStore((s) => {
    const desc = s.getNotesageSkillDescriptionsForPrompt();
    if (!agentAllowedTools || agentAllowedTools.length === 0) return desc;
    const active = s.getActiveSkills().filter(
      (sk) => agentAllowedTools.includes(sk.name) &&
        (sk.source === 'notesage-project' || sk.source === 'notesage-global')
    );
    if (active.length === 0) return '';
    const lines = active.map((sk) => `- **${sk.name}**: ${sk.description}${sk.has_scripts ? ' (has scripts)' : ''}`);
    return `\n\nNotesage skills:\n${lines.join('\n')}`;
  });
  const agentInstructions = useSkillStore((s) => s.getMergedAgentInstructions());
  const notesageAgentInstructions = useSkillStore((s) => s.getNotesageAgentInstructions());

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
        const treeContext = buildFileTreeContext(singleProject.fileTree, singleProjectPath!);
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

    // Attach file paths from context pills (or fall back to active tab for non-chat callers)
    if (attachedFilePaths && attachedFilePaths.length > 0) {
      for (const filePath of attachedFilePaths) {
        parts.push(`File in context: ${filePath}`);
      }
    } else if (!attachedFilePaths && activeTab) {
      parts.push(`Currently editing: ${activeTab.filePath}`);
    }

    return parts;
  }, [selectedProjectPaths, singleProjectPath, singleMetadata, goalsContext, singleProject, activeTab, metadataMap]);

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

  // Lightweight system message for local models
  const localSystemMessage = useMemo(() => {
    if (agentSystemMessage) return agentSystemMessage;
    return 'You are a helpful writing assistant. Be concise and focused.';
  }, [agentSystemMessage]);

  // ACP-specific system message builder
  const buildAcpSystemMessage = useCallback((attachedFilePaths?: string[]) => {
    const parts = buildProjectContext(attachedFilePaths);
    if (notesageAgentInstructions) parts.push(notesageAgentInstructions);
    if (agentSystemMessage) {
      parts.push(`<role-instructions>\nYou MUST adopt the following role for all responses in this conversation. This is your primary identity and overrides your default behavior:\n\n${agentSystemMessage}\n</role-instructions>`);
    }
    if (notesageSkillDescriptions) parts.push(notesageSkillDescriptions);
    return parts.join('\n\n') || 'You are a helpful writing assistant.';
  }, [buildProjectContext, agentSystemMessage, notesageAgentInstructions, notesageSkillDescriptions]);

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
