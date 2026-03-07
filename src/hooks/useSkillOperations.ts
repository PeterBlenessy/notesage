import { useEffect, useCallback } from 'react';
import { useSkillStore, type SkillContent, type ScriptResult, type AgentContent } from '@/stores/skill-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useAIStore } from '@/stores/ai-store';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import type { ConnectionProvider } from '@/lib/ai/connections';

/** Map connection provider to skill discovery filesystem paths. */
function getSkillPathsForProvider(provider: ConnectionProvider): string[] {
  switch (provider) {
    case 'anthropic':
      // Only scan claude skills if the connection is agent_managed (Claude Code)
      // API key connections don't have a local skills directory
      return [];
    case 'openai':
      return [];
    case 'github':
      return ['~/.agents/skills'];
    case 'google':
      return ['~/.gemini/skills', '~/.agents/skills'];
    case 'ollama':
      return [];
    case 'openai_compatible':
      return [];
    default:
      return [];
  }
}

/** Map connection provider + auth method to skill paths. */
function getSkillPathsForConnection(provider: ConnectionProvider, authMethod: string): string[] {
  if (authMethod !== 'agent_managed') return [];
  switch (provider) {
    case 'anthropic': return ['~/.claude/skills'];
    case 'openai': return ['~/.codex/skills'];
    case 'github': return ['~/.agents/skills'];
    case 'google': return ['~/.gemini/skills', '~/.agents/skills'];
    default: return getSkillPathsForProvider(provider);
  }
}

/** Map connection provider + auth method to agent discovery paths. */
function getAgentPathsForConnection(provider: ConnectionProvider, authMethod: string): string[] {
  if (authMethod === 'agent_managed') {
    switch (provider) {
      case 'anthropic': return ['~/.claude/agents'];
      case 'openai': return ['~/.codex/agents'];
      case 'github': return ['~/.github/agents'];
      case 'google': return ['~/.gemini/agents'];
      default: return [];
    }
  }
  // Copilot LSP also has agents
  if (provider === 'github') return ['~/.github/agents'];
  return [];
}

/** Resolve ~ to the home directory. */
async function expandHome(path: string): Promise<string> {
  if (!path.startsWith('~/')) return path;
  const home = await invoke<string>('get_home_dir');
  return path.replace('~', home);
}

/** Get connected provider type strings for agent instruction discovery. */
function getConnectedProviderTypes(): string[] {
  const connections = useConnectionsStore.getState().connections;
  const types: string[] = [];
  for (const conn of connections) {
    if (conn.status === 'connected' || conn.status === 'expired') {
      if (conn.provider === 'anthropic' && conn.authMethod === 'agent_managed') {
        types.push('claude-code');
      } else if (conn.provider === 'google') {
        types.push('gemini');
      } else {
        types.push(conn.provider);
      }
    }
  }
  return types;
}

/** Built-in persona ID → bundled agent name mapping. */
const PERSONA_TO_AGENT: Record<string, string> = {
  'general': 'general-assistant',
  'creative': 'creative-writer',
  'technical': 'technical-editor',
  'fact-checker': 'fact-checker',
  'academic': 'academic-writer',
  'copywriter': 'copywriter',
  'proofreader': 'proofreader',
};

/**
 * One-time migration: writes custom personas as agent `.md` files,
 * maps activePersonaId → activeAgentName, and sets the migration flag.
 *
 * Re-runs if any custom persona file is missing (handles failed first attempts).
 */
async function migratePersonasToAgents(home: string) {
  const { personasMigrated, setPersonasMigrated } = useSettingsStore.getState();
  const aiStore = useAIStore.getState();
  const customPersonas = aiStore.customPersonas;

  // Check if migration is needed: either flag not set, or files are missing
  if (personasMigrated && customPersonas.length === 0) return;

  const agentsDir = `${home}/.notesage/agents`;

  if (customPersonas.length > 0) {
    // Check if all expected files exist
    let allExist = personasMigrated;
    if (personasMigrated) {
      for (const persona of customPersonas) {
        const slug = persona.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const filePath = `${agentsDir}/${slug}.md`;
        try {
          const exists = await invoke<boolean>('path_exists', { path: filePath });
          if (!exists) { allExist = false; break; }
        } catch { allExist = false; break; }
      }
      if (allExist) return; // All files present, nothing to do
    }

    // Ensure directory exists
    try {
      await invoke('create_directory', { path: agentsDir });
    } catch {
      // Directory may already exist
    }

    let migratedCount = 0;
    for (const persona of customPersonas) {
      const slug = persona.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const filePath = `${agentsDir}/${slug}.md`;

      // Build agent file content
      const frontmatter = [
        '---',
        `name: "${persona.name}"`,
        `description: "Migrated from custom persona"`,
        persona.icon ? `icon: "${persona.icon}"` : null,
        '---',
      ].filter(Boolean).join('\n');

      const content = `${frontmatter}\n\n${persona.systemMessage}`;

      try {
        const exists = await invoke<boolean>('path_exists', { path: filePath });
        if (!exists) {
          await invoke('write_file', { path: filePath, content });
          migratedCount++;
        }
      } catch (e) {
        console.warn(`Failed to migrate persona "${persona.name}":`, e);
      }
    }

    if (migratedCount > 0) {
      toast.success(`Migrated ${migratedCount} custom persona${migratedCount === 1 ? '' : 's'} to agent files`);
    }
  }

  // Map activePersonaId to activeAgentName (only on first migration)
  if (!personasMigrated) {
    const skillStore = useSkillStore.getState();
    const activePersonaId = aiStore.activePersonaId;
    const mappedAgentName = PERSONA_TO_AGENT[activePersonaId];
    if (mappedAgentName) {
      skillStore.setActiveAgent(mappedAgentName);
    } else if (activePersonaId) {
      const customPersona = customPersonas.find((p) => p.id === activePersonaId);
      if (customPersona) {
        const slug = customPersona.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        skillStore.setActiveAgent(slug);
      }
    }
  }

  setPersonasMigrated(true);
}

/**
 * Hook that manages skill discovery lifecycle.
 * Runs initial scan after startupReady, rescans on connection or project changes.
 */
export function useSkillDiscovery() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  const connections = useConnectionsStore((s) => s.connections);
  const projects = useWorkspaceStore((s) => s.projects);

  useEffect(() => {
    if (!startupReady) return;

    const run = async () => {
      // Extract bundled skills and agents (always overwrites to stay current)
      try {
        await invoke<string>('extract_bundled_skills');
      } catch (e) {
        console.warn('Failed to extract bundled skills:', e);
      }
      try {
        await invoke<string>('extract_bundled_agents');
      } catch (e) {
        console.warn('Failed to extract bundled agents:', e);
      }

      const home = await invoke<string>('get_home_dir');

      // One-time migration: custom personas → agent files
      await migratePersonasToAgents(home);

      const baseDirs: string[] = [];
      baseDirs.push(`${home}/.notesage/skills`);
      baseDirs.push(`${home}/.notesage/bundled-skills`);

      // Project-level skills
      for (const project of projects) {
        baseDirs.push(`${project.path}/.notesage/skills`);
      }

      // Provider-specific skills based on active connections
      const seen = new Set<string>();
      for (const conn of connections) {
        if (conn.status !== 'connected' && conn.status !== 'expired') continue;
        const paths = getSkillPathsForConnection(conn.provider, conn.authMethod);
        for (const p of paths) {
          const expanded = await expandHome(p);
          if (!seen.has(expanded)) {
            seen.add(expanded);
            baseDirs.push(expanded);
          }
        }
      }

      // Scan skills
      await useSkillStore.getState().scanSkills(baseDirs);

      // Build agent base dirs
      const agentBaseDirs: string[] = [];
      agentBaseDirs.push(`${home}/.notesage/agents`);
      agentBaseDirs.push(`${home}/.notesage/bundled-agents`);

      // Project-level agents
      for (const project of projects) {
        agentBaseDirs.push(`${project.path}/.notesage/agents`);
        // Also scan .github/agents for Copilot project agents
        agentBaseDirs.push(`${project.path}/.github/agents`);
      }

      // Provider-specific agents based on active connections
      const agentSeen = new Set<string>();
      for (const conn of connections) {
        if (conn.status !== 'connected' && conn.status !== 'expired') continue;
        const paths = getAgentPathsForConnection(conn.provider, conn.authMethod);
        for (const p of paths) {
          const expanded = await expandHome(p);
          if (!agentSeen.has(expanded)) {
            agentSeen.add(expanded);
            agentBaseDirs.push(expanded);
          }
        }
      }

      // Scan agents
      await useSkillStore.getState().scanAgents(agentBaseDirs);

      // Scan agent instructions (use first project as root, or null)
      const projectRoot = projects.length > 0 ? projects[0].path : null;
      const providerTypes = getConnectedProviderTypes();
      await useSkillStore.getState().scanAgentInstructions(projectRoot, providerTypes);
    };

    run();
  }, [startupReady, connections, projects]);
}

/**
 * Hook providing skill content reading and script execution with permission checks.
 */
export function useSkillOperations() {
  const readSkillContent = useCallback(async (skillPath: string): Promise<SkillContent> => {
    return invoke<SkillContent>('read_skill_content', { skillPath });
  }, []);

  const readAgentContent = useCallback(async (agentPath: string): Promise<AgentContent> => {
    return invoke<AgentContent>('read_agent_content', { agentPath });
  }, []);

  const executeScript = useCallback(async (
    skillName: string,
    skillPath: string,
    script: string,
    args: string[] = [],
    workingDir?: string,
  ): Promise<ScriptResult> => {
    // Check permission
    const tier = usePermissionStore.getState().isSkillScriptAllowed(skillName);
    if (tier === 'none') {
      // Caller is responsible for showing permission UI and retrying
      throw new Error(`PERMISSION_REQUIRED:${skillName}`);
    }

    return invoke<ScriptResult>('execute_skill_script', {
      skillPath,
      script,
      args,
      workingDir: workingDir ?? null,
      env: null,
      timeoutMs: null,
    });
  }, []);

  return { readSkillContent, readAgentContent, executeScript };
}
