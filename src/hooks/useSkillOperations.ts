import { useEffect, useCallback } from 'react';
import { useSkillStore, type SkillContent, type ScriptResult } from '@/stores/skill-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePermissionStore } from '@/stores/permission-store';
import { invoke } from '@tauri-apps/api/core';
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
      // Extract bundled skills to ~/.notesage/bundled-skills/ (always overwrites to stay current)
      try {
        await invoke<string>('extract_bundled_skills');
      } catch (e) {
        console.warn('Failed to extract bundled skills:', e);
      }

      const baseDirs: string[] = [];

      // Always include Notesage global skills
      const home = await invoke<string>('get_home_dir');
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

  return { readSkillContent, executeScript };
}
