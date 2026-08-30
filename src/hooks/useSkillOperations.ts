import { useEffect, useCallback } from 'react';
import { useSkillStore, skillSourceToItemSource, type SkillContent, type ScriptResult, type AgentContent } from '@/stores/skill-store';
import { track } from '@/lib/telemetry';
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

/**
 * Reset the once-per-session extraction flag. **Tests only.**
 *
 * This is MODULE state, not store state, so `resetStores()` never touched it
 * and it outlives any single test file: whichever file exercised discovery
 * first left it `true` for every file that ran afterwards. In the fixed test
 * order that happened to be harmless; under a shuffled order the two
 * extraction tests failed depending on who ran first (#736).
 *
 * Exported rather than worked around in the test, because a module-level
 * mutable with no way to reset it is the defect — the same class as the
 * singletons #413 tracks.
 */
export function __resetBundledExtractionForTests(): void {
  bundledExtracted = false;
}

/**
 * Build skill and agent discovery directory buckets for scanning.
 *
 * Returns per-project buckets so `scanSkills`/`scanAgents` can annotate each
 * discovered entry with its `projectRoot` — the store then filters entries by
 * the active chat's `selectedProjectPaths` to prevent cross-project leaks
 * (Task #18).
 *
 * Explorer folders are grouped alongside projects so their skills/agents also
 * get scoped (treated as pseudo-projects for isolation purposes).
 */
function buildDiscoveryDirs(
  home: string,
  connections: { provider: ConnectionProvider; authMethod: string; status: string }[],
  projects: { path: string }[],
  explorerFolders: { path: string }[],
) {
  // --- Skill directories ---
  const skillGlobalDirs: string[] = [`${home}/.notesage/skills`];
  const skillByProject: Record<string, string[]> = {};
  for (const project of projects) {
    skillByProject[project.path] = [`${project.path}/.notesage/skills`];
  }

  const seen = new Set<string>();
  for (const conn of connections) {
    if (conn.status !== 'connected' && conn.status !== 'expired') continue;
    const paths = getSkillPathsForConnection(conn.provider, conn.authMethod);
    for (const p of paths) {
      const expanded = expandHomeSync(p, home);
      if (!seen.has(expanded)) {
        seen.add(expanded);
        skillGlobalDirs.push(expanded);
      }
    }
  }

  // --- Agent directories (per-project buckets) ---
  const agentGlobalDirs: string[] = [];
  const agentByProject: Record<string, string[]> = {};

  const globalSeen = new Set<string>();
  const addGlobal = (dir: string) => {
    if (!globalSeen.has(dir)) {
      globalSeen.add(dir);
      agentGlobalDirs.push(dir);
    }
  };

  // Global Notesage agents
  addGlobal(`${home}/.notesage/agents`);

  // Global provider agent directories — always scanned, not gated on connections.
  addGlobal(`${home}/.claude/agents`);
  addGlobal(`${home}/.codex/agents`);
  addGlobal(`${home}/.gemini/agents`);
  addGlobal(`${home}/.copilot/agents`);

  // Additional provider-specific agent dirs from active connections
  for (const conn of connections) {
    if (conn.status !== 'connected' && conn.status !== 'expired') continue;
    const paths = getAgentPathsForConnection(conn.provider, conn.authMethod);
    for (const p of paths) addGlobal(expandHomeSync(p, home));
  }

  // Per-project agent directories (scoped).
  const addToBucket = (root: string, dir: string) => {
    (agentByProject[root] ??= []).push(dir);
  };
  for (const project of projects) {
    addToBucket(project.path, `${project.path}/.notesage/agents`);
    addToBucket(project.path, `${project.path}/.github/agents`);
    addToBucket(project.path, `${project.path}/.claude/agents`);
    addToBucket(project.path, `${project.path}/.gemini/agents`);
  }

  // Explorer folders — treat each as its own scope bucket so their skills/agents
  // don't leak into arbitrary project chats either.
  for (const folder of explorerFolders) {
    addToBucket(folder.path, `${folder.path}/.notesage/agents`);
    addToBucket(folder.path, `${folder.path}/.github/agents`);
    addToBucket(folder.path, `${folder.path}/.claude/agents`);
    addToBucket(folder.path, `${folder.path}/.gemini/agents`);
  }

  // Backward-compatible flat views (deprecated — still used by the Phase 2
  // rescan path that re-reads after bundled extraction). Computed from the
  // buckets so callers don't need to iterate twice.
  const baseDirs: string[] = [
    ...skillGlobalDirs,
    ...Object.values(skillByProject).flat(),
  ];
  const agentBaseDirs: string[] = [
    ...agentGlobalDirs,
    ...Object.values(agentByProject).flat(),
  ];

  return {
    baseDirs,
    agentBaseDirs,
    skillGlobalDirs,
    skillByProject,
    agentGlobalDirs,
    agentByProject,
  };
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
      const dirs = buildDiscoveryDirs(home, connections, projects, explorerFolders);

      const totalSkillDirs = dirs.skillGlobalDirs.length + Object.values(dirs.skillByProject).flat().length;
      log.info('skills', `Scanning skills in ${totalSkillDirs} directories (${Object.keys(dirs.skillByProject).length} projects)`);
      let stepStart = performance.now();
      await useSkillStore.getState().scanSkills({
        globalDirs: dirs.skillGlobalDirs,
        byProject: dirs.skillByProject,
      });
      const initialSkillCount = useSkillStore.getState().skills.length;
      log.info('skills', `Discovered ${initialSkillCount} skills`);
      console.log('[perf:skills]', { step: 'skill-scan', ms: Math.round(performance.now() - stepStart) });

      // Extract tool definitions from script-bearing skills (all active, unscoped).
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

      const totalAgentDirs = dirs.agentGlobalDirs.length + Object.values(dirs.agentByProject).flat().length;
      log.info('skills', `Scanning agents in ${totalAgentDirs} directories`);
      stepStart = performance.now();
      await useSkillStore.getState().scanAgents({
        globalDirs: dirs.agentGlobalDirs,
        byProject: dirs.agentByProject,
      });
      const initialAgentCount = useSkillStore.getState().agents.length;
      log.info('skills', `Discovered ${initialAgentCount} agents`);
      console.log('[perf:skills]', { step: 'agent-scan', ms: Math.round(performance.now() - stepStart) });

      // Scan agent instructions for ALL known projects + global. Scoping
      // happens at read time via `selectedProjectPaths` (see useAIContext.ts).
      // This fixes Task #19: the old path only scanned `projects[0]`, silently
      // leaking Project A's CLAUDE.md into Project B's chat.
      const allProjectRoots = projects.map((p) => p.path);
      const providerTypes = getConnectedProviderTypes();
      stepStart = performance.now();
      await useSkillStore.getState().scanAgentInstructions(allProjectRoots, providerTypes);
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

        // Rescan to pick up any new or updated bundled skills — same
        // per-project buckets so projectRoot annotations stay intact.
        await useSkillStore.getState().scanSkills({
          globalDirs: dirs.skillGlobalDirs,
          byProject: dirs.skillByProject,
        });
        const finalSkillCount = useSkillStore.getState().skills.length;
        await useSkillStore.getState().scanAgents({
          globalDirs: dirs.agentGlobalDirs,
          byProject: dirs.agentByProject,
        });
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
    // Content-pin the approval (security audit HIGH #2): hash the exact script
    // body about to run and gate the "allow always" check on it, so a rewritten
    // script re-prompts instead of running under a stale approval. If hashing
    // fails (e.g. file vanished), treat as not-approved.
    let contentHash: string | undefined;
    try {
      contentHash = await tauriApi.hashSkillScript(skillPath, script);
    } catch {
      contentHash = undefined;
    }

    const tier = usePermissionStore
      .getState()
      .isSkillScriptAllowed(skillName, null, null, contentHash);
    if (tier === 'none') {
      // Caller is responsible for showing permission UI and retrying
      throw new Error(`PERMISSION_REQUIRED:${skillName}`);
    }

    const skill = useSkillStore.getState().skills.find((s) => s.name === skillName);
    track('skill_invoked', { source: skill ? skillSourceToItemSource(skill.source) : 'user' });

    return tauriApi.executeSkillScript({
      skillPath,
      script,
      args,
      workingDir: workingDir ?? null,
      env: null,
      timeoutMs: null,
      // Backend re-verifies the body matches what we just hashed, closing the
      // check→exec window.
      expectedHash: contentHash ?? null,
    });
  }, []);

  return { readSkillContent, readAgentContent, executeScript };
}
