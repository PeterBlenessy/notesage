import { useEffect, useCallback } from 'react';
import { useSkillStore, type SkillContent, type ScriptResult, type AgentContent } from '@/stores/skill-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePermissionStore } from '@/stores/permission-store';
import { useAIStore } from '@/stores/ai-store';
import { tauriApi } from '@/lib/tauri';
import { toast } from 'sonner';
import { log } from '@/lib/logger';
import type { ConnectionProvider } from '@/lib/ai/connections';

/** Map connection provider + auth method to skill paths. */
function getSkillPathsForConnection(provider: ConnectionProvider, authMethod: string): string[] {
  if (authMethod !== 'agent_managed') return [];
  switch (provider) {
    case 'anthropic': return ['~/.claude/skills'];
    case 'openai': return ['~/.codex/skills'];
    case 'github': return ['~/.agents/skills'];
    case 'google': return ['~/.gemini/skills', '~/.agents/skills'];
    default: return [];
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
  const home = await tauriApi.getHomeDir();
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

/** Convert a persona name to a filesystem-safe slug for agent file naming. */
function personaToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
        const slug = personaToSlug(persona.name);
        const filePath = `${agentsDir}/${slug}.md`;
        try {
          const exists = await tauriApi.pathExists(filePath);
          if (!exists) { allExist = false; break; }
        } catch { allExist = false; break; } // Expected: pathExists may fail for inaccessible paths
      }
      if (allExist) return; // All files present, nothing to do
    }

    // Ensure directory exists
    try {
      await tauriApi.createDirectory(agentsDir);
    } catch {
      // Expected: createDirectory fails if directory already exists
    }

    let migratedCount = 0;
    for (const persona of customPersonas) {
      const slug = personaToSlug(persona.name);
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
        const exists = await tauriApi.pathExists(filePath);
        if (!exists) {
          await tauriApi.writeFile(filePath, content);
          migratedCount++;
        }
      } catch (e) {
        log.warn('skills', `Failed to migrate persona "${persona.name}"`, e);
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

// Track whether bundled extraction has already run this session.
// Extraction only needs to happen once on startup — rescans triggered by
// connection/project changes only re-scan directories (no extraction).
let bundledExtracted = false;

/**
 * Hook that manages skill discovery lifecycle.
 * Runs initial scan after startupReady, rescans on connection or project changes.
 */
export function useSkillDiscovery() {
  const startupReady = useSettingsStore((s) => s.startupReady);
  // Derive a stable key from connections: only rescan when the set of
  // connected providers changes, not on every config/status update.
  const connectionKey = useConnectionsStore((s) =>
    s.connections
      .filter((c) => c.status === 'connected' || c.status === 'expired')
      .map((c) => `${c.provider}:${c.authMethod}`)
      .sort()
      .join(',')
  );
  const projectPaths = useWorkspaceStore((s) =>
    s.projects.map((p) => p.path).sort().join(',')
  );
  const rescanCounter = useSkillStore((s) => s.rescanCounter);

  useEffect(() => {
    if (!startupReady) return;

    // Read full state inside the effect (not as a dependency)
    const connections = useConnectionsStore.getState().connections;
    const projects = useWorkspaceStore.getState().projects;

    const run = async () => {
      log.info('skills', 'Starting skill/agent discovery pipeline');

      // Extract bundled skills and agents once per session (on startup).
      // Rescans triggered by connection/project changes skip extraction to
      // avoid the extraction → watcher → rescan → extraction loop.
      let skillsExtracted = false;
      let agentsExtracted = false;
      if (!bundledExtracted) {
        try {
          const skillsPath = await tauriApi.extractBundledSkills();
          skillsExtracted = true;
          log.info('skills', `Extracted bundled skills to ${skillsPath}`);
        } catch (e) {
          log.error('skills', 'Failed to extract bundled skills', e);
          toast.error('Failed to extract bundled skills. Check logs for details.');
        }
        try {
          const agentsPath = await tauriApi.extractBundledAgents();
          agentsExtracted = true;
          log.info('skills', `Extracted bundled agents to ${agentsPath}`);
        } catch (e) {
          log.error('skills', 'Failed to extract bundled agents', e);
          toast.error('Failed to extract bundled agents. Check logs for details.');
        }
        bundledExtracted = true;
      }

      let home: string;
      try {
        home = await tauriApi.getHomeDir();
        log.info('skills', `Home directory: ${home}`);
      } catch (e) {
        log.error('skills', 'Failed to resolve home directory', e);
        toast.error('Failed to resolve home directory for skill discovery.');
        return;
      }

      // One-time migration: custom personas → agent files
      await migratePersonasToAgents(home);

      const baseDirs: string[] = [];
      baseDirs.push(`${home}/.notesage/skills`);

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
      log.info('skills', `Scanning skills in ${baseDirs.length} directories`);
      await useSkillStore.getState().scanSkills(baseDirs);
      const skillCount = useSkillStore.getState().skills.length;
      log.info('skills', `Discovered ${skillCount} skills`);

      // Build agent base dirs
      const agentBaseDirs: string[] = [];
      agentBaseDirs.push(`${home}/.notesage/agents`);

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
      log.info('skills', `Scanning agents in ${agentBaseDirs.length} directories`);
      await useSkillStore.getState().scanAgents(agentBaseDirs);
      const agentCount = useSkillStore.getState().agents.length;
      log.info('skills', `Discovered ${agentCount} agents`);

      // Warn if extraction succeeded but nothing was discovered
      if (skillsExtracted && skillCount === 0) {
        log.warn('skills', 'Skills extraction succeeded but no skills were discovered');
      }
      if (agentsExtracted && agentCount === 0) {
        log.warn('skills', 'Agents extraction succeeded but no agents were discovered');
      }

      // Scan agent instructions (use first project as root, or null)
      const projectRoot = projects.length > 0 ? projects[0].path : null;
      const providerTypes = getConnectedProviderTypes();
      await useSkillStore.getState().scanAgentInstructions(projectRoot, providerTypes);

      log.info('skills', 'Skill/agent discovery pipeline complete');
    };

    run().catch((e) => {
      log.error('skills', 'Unhandled error in skill/agent discovery pipeline', e);
      toast.error('Failed to load skills and agents. Check logs for details.');
    });
  }, [startupReady, connectionKey, projectPaths, rescanCounter]);
}

/**
 * Hook providing skill content reading and script execution with permission checks.
 */
export function useSkillOperations() {
  const readSkillContent = useCallback(async (skillPath: string): Promise<SkillContent> => {
    return tauriApi.readSkillContent(skillPath);
  }, []);

  const readAgentContent = useCallback(async (agentPath: string): Promise<AgentContent> => {
    return tauriApi.readAgentContent(agentPath);
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

    return tauriApi.executeSkillScript({
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
