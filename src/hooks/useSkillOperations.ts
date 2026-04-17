import { useEffect, useCallback } from 'react';
import { useSkillStore, type SkillContent, type ScriptResult, type AgentContent } from '@/stores/skill-store';
import { useConnectionsStore } from '@/stores/connections-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSettingsStore } from '@/stores/settings-store';
import { usePermissionStore } from '@/stores/permission-store';
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
    case 'github': return ['~/.copilot/skills'];
    case 'google': return ['~/.gemini/skills'];
    default: return [];
  }
}

/** Map connection provider + auth method to agent discovery paths. */
function getAgentPathsForConnection(provider: ConnectionProvider, authMethod: string): string[] {
  if (authMethod === 'agent_managed') {
    switch (provider) {
      case 'anthropic': return ['~/.claude/agents'];
      case 'openai': return ['~/.codex/agents'];
      case 'github': return ['~/.copilot/agents'];
      case 'google': return ['~/.gemini/agents'];
      default: return [];
    }
  }
  // Copilot LSP also has agents
  if (provider === 'github') return ['~/.copilot/agents'];
  return [];
}

/** Resolve ~ to the home directory. */
function expandHomeSync(path: string, home: string): string {
  if (!path.startsWith('~/')) return path;
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

// Track whether bundled extraction has already run this session.
// Extraction only needs to happen once on startup — rescans triggered by
// connection/project changes only re-scan directories (no extraction).
let bundledExtracted = false;

/** Build skill and agent directory lists for scanning. No async — all paths resolved synchronously. */
function buildDiscoveryDirs(
  home: string,
  connections: { provider: ConnectionProvider; authMethod: string; status: string }[],
  projects: { path: string }[],
  explorerFolders: { path: string }[],
) {
  const baseDirs: string[] = [];
  baseDirs.push(`${home}/.notesage/skills`);
  for (const project of projects) {
    baseDirs.push(`${project.path}/.notesage/skills`);
  }
  const seen = new Set<string>();
  for (const conn of connections) {
    if (conn.status !== 'connected' && conn.status !== 'expired') continue;
    const paths = getSkillPathsForConnection(conn.provider, conn.authMethod);
    for (const p of paths) {
      const expanded = expandHomeSync(p, home);
      if (!seen.has(expanded)) {
        seen.add(expanded);
        baseDirs.push(expanded);
      }
    }
  }

  // Agent directories: global, per-project, per-explorer-folder, per-provider
  const agentBaseDirs: string[] = [];
  const agentSeen = new Set<string>();
  const addAgentDir = (dir: string) => {
    if (!agentSeen.has(dir)) {
      agentSeen.add(dir);
      agentBaseDirs.push(dir);
    }
  };

  // Global Notesage agents
  addAgentDir(`${home}/.notesage/agents`);

  // Global provider agent directories — always scanned, not gated on connections.
  // Discovery is fast (just reads directory + parses frontmatter) and showing all
  // agents in the @ menu is useful even before connecting a provider.
  addAgentDir(`${home}/.claude/agents`);
  addAgentDir(`${home}/.codex/agents`);
  addAgentDir(`${home}/.gemini/agents`);
  addAgentDir(`${home}/.copilot/agents`);

  // Per-project agent directories (all provider conventions)
  for (const project of projects) {
    addAgentDir(`${project.path}/.notesage/agents`);
    addAgentDir(`${project.path}/.github/agents`);
    addAgentDir(`${project.path}/.claude/agents`);
    addAgentDir(`${project.path}/.gemini/agents`);
  }

  // Explorer folders — also scan for agents (same provider directories)
  for (const folder of explorerFolders) {
    addAgentDir(`${folder.path}/.notesage/agents`);
    addAgentDir(`${folder.path}/.github/agents`);
    addAgentDir(`${folder.path}/.claude/agents`);
    addAgentDir(`${folder.path}/.gemini/agents`);
  }

  // Additional provider-specific agent directories from active connections
  // (catches any paths not covered by the unconditional global scan above)
  for (const conn of connections) {
    if (conn.status !== 'connected' && conn.status !== 'expired') continue;
    const paths = getAgentPathsForConnection(conn.provider, conn.authMethod);
    for (const p of paths) {
      addAgentDir(expandHomeSync(p, home));
    }
  }

  return { baseDirs, agentBaseDirs };
}

/**
 * Hook that manages skill discovery lifecycle.
 * Runs initial scan after skillsReady (fires early — before tree validation),
 * rescans on connection or project changes.
 */
export function useSkillDiscovery() {
  const skillsReady = useSettingsStore((s) => s.skillsReady);
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
  const explorerPaths = useWorkspaceStore((s) =>
    s.explorerFolders.map((f) => f.path).sort().join(',')
  );
  const rescanCounter = useSkillStore((s) => s.rescanCounter);

  useEffect(() => {
    if (!skillsReady) return;

    // Read full state inside the effect (not as a dependency)
    const connections = useConnectionsStore.getState().connections;
    const projects = useWorkspaceStore.getState().projects;
    const explorerFolders = useWorkspaceStore.getState().explorerFolders;

    const run = async () => {
      log.info('skills', 'Starting skill/agent discovery pipeline');
      const pipelineStart = performance.now();

      // Use home dir from settings (resolved once on startup) to avoid IPC contention
      const home = useSettingsStore.getState().homeDir;
      if (!home) {
        log.error('skills', 'Home directory not resolved yet');
        return;
      }
      log.info('skills', `Home directory: ${home}`);

      // --- Phase 1: Scan existing files and populate tools immediately ---
      const { baseDirs, agentBaseDirs } = buildDiscoveryDirs(home, connections, projects, explorerFolders);

      log.info('skills', `Scanning skills in ${baseDirs.length} directories`);
      let stepStart = performance.now();
      await useSkillStore.getState().scanSkills(baseDirs);
      const initialSkillCount = useSkillStore.getState().skills.length;
      log.info('skills', `Discovered ${initialSkillCount} skills`);
      console.log('[perf:skills]', { step: 'skill-scan', ms: Math.round(performance.now() - stepStart) });

      // Extract tool definitions from script-bearing skills
      stepStart = performance.now();
      try {
        const activeSkills = useSkillStore.getState().getActiveSkills();
        const skillTools = await tauriApi.extractSkillTools(activeSkills);
        useSkillStore.getState().setSkillTools(skillTools);
        log.info('skills', `Extracted ${skillTools.length} skill tool definitions`);
        console.log('[perf:skills]', { step: 'skill-tool-extract', count: skillTools.length, ms: Math.round(performance.now() - stepStart) });
      } catch (e) {
        log.error('skills', 'Skill tool extraction failed', e);
      }

      log.info('skills', `Scanning agents in ${agentBaseDirs.length} directories`);
      stepStart = performance.now();
      await useSkillStore.getState().scanAgents(agentBaseDirs);
      const initialAgentCount = useSkillStore.getState().agents.length;
      log.info('skills', `Discovered ${initialAgentCount} agents`);
      console.log('[perf:skills]', { step: 'agent-scan', ms: Math.round(performance.now() - stepStart) });

      // Scan agent instructions (use first project as root, or null)
      const projectRoot = projects.length > 0 ? projects[0].path : null;
      const providerTypes = getConnectedProviderTypes();
      stepStart = performance.now();
      await useSkillStore.getState().scanAgentInstructions(projectRoot, providerTypes);
      console.log('[perf:skills]', { step: 'instruction-scan', ms: Math.round(performance.now() - stepStart) });

      const phase1Ms = Math.round(performance.now() - pipelineStart);
      console.log('[perf:skills] phase1-ready', { skillCount: initialSkillCount, agentCount: initialAgentCount, ms: phase1Ms });
      log.info('skills', 'Phase 1 complete — tools available');

      // --- Phase 2: Extract bundled skills + one-time bundled agent cleanup ---
      if (!bundledExtracted) {
        stepStart = performance.now();
        try {
          await tauriApi.extractBundledSkills();
        } catch (e) {
          log.error('skills', 'Failed to extract bundled skills', e);
        }
        console.log('[perf:skills]', { step: 'bundled-skills-extract', ms: Math.round(performance.now() - stepStart) });

        // One-time cleanup: remove previously extracted bundled agents
        const { bundledAgentsCleaned, setBundledAgentsCleaned } = useSettingsStore.getState();
        if (!bundledAgentsCleaned) {
          stepStart = performance.now();
          try {
            const removed = await tauriApi.cleanupBundledAgents();
            if (removed > 0) {
              log.info('skills', `Cleaned up ${removed} bundled agent files`);
            }
            setBundledAgentsCleaned(true);
          } catch (e) {
            log.error('skills', 'Failed to clean up bundled agents', e);
          }
          console.log('[perf:skills]', { step: 'bundled-agents-cleanup', ms: Math.round(performance.now() - stepStart) });
        }

        bundledExtracted = true;

        // Rescan to pick up any new or updated bundled skills
        await useSkillStore.getState().scanSkills(baseDirs);
        const finalSkillCount = useSkillStore.getState().skills.length;
        await useSkillStore.getState().scanAgents(agentBaseDirs);
        const finalAgentCount = useSkillStore.getState().agents.length;

        // Re-extract tool definitions if skill count changed
        if (finalSkillCount !== initialSkillCount) {
          try {
            const activeSkills = useSkillStore.getState().getActiveSkills();
            const skillTools = await tauriApi.extractSkillTools(activeSkills);
            useSkillStore.getState().setSkillTools(skillTools);
            log.info('skills', `Updated skill tools after extraction: ${skillTools.length}`);
          } catch (e) {
            log.error('skills', 'Skill tool re-extraction failed', e);
          }
        }

        console.log('[perf:skills] phase2-extract', {
          skillsBefore: initialSkillCount, skillsAfter: finalSkillCount,
          agentsBefore: initialAgentCount, agentsAfter: finalAgentCount,
          ms: Math.round(performance.now() - pipelineStart) - phase1Ms,
        });
      }

      const totalMs = Math.round(performance.now() - pipelineStart);
      console.log('[perf:skills] total', { skillCount: useSkillStore.getState().skills.length, agentCount: useSkillStore.getState().agents.length, totalMs });
      log.info('skills', 'Skill/agent discovery pipeline complete');
    };

    run().catch((e) => {
      log.error('skills', 'Unhandled error in skill/agent discovery pipeline', e);
      toast.error('Failed to load skills and agents. Check logs for details.');
    });
  }, [skillsReady, connectionKey, projectPaths, explorerPaths, rescanCounter]);
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
