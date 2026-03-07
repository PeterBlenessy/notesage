import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tauriApi } from '@/lib/tauri';
import type { SkillEntry, AgentInstruction, AgentEntry } from '@/lib/tauri';

// Re-export types from tauri.ts for consumers that import from skill-store
export type { SkillEntry, SkillContent, ScriptResult, AgentInstruction, AgentEntry, AgentContent } from '@/lib/tauri';

// --- Store ---

interface SkillStore {
  /** All discovered skills (rebuilt from scan, not persisted). */
  skills: SkillEntry[];

  /** User overrides for skill enabled state (skill path → enabled). Persisted. */
  enabledOverrides: Record<string, boolean>;

  /** Discovered agent instruction files (rebuilt from scan, not persisted). */
  agentInstructions: AgentInstruction[];

  /** Timestamp of last successful scan. */
  lastScanTimestamp: number;

  /** Whether a scan is currently in progress. */
  isScanning: boolean;

  /** Counter bumped to trigger a rescan from external events (e.g. file watcher). */
  rescanCounter: number;

  // --- Agent state ---

  /** All discovered addressable agents (rebuilt from scan, not persisted). */
  agents: AgentEntry[];

  /** Currently active agent name. Persisted. */
  activeAgentName: string;

  /** User overrides for agent enabled state (agent path → enabled). Persisted. */
  agentEnabledOverrides: Record<string, boolean>;

  // --- Skill methods ---

  /** Get active skills: enabled, respecting hierarchy (same-name: project > global > external). */
  getActiveSkills: () => SkillEntry[];

  /** Get a skill by name from active skills. */
  getSkillByName: (name: string) => SkillEntry | undefined;

  /** Format active skill descriptions for AI system message injection. */
  getSkillDescriptionsForPrompt: () => string;

  /** Get Notesage-specific skill descriptions only (for ACP injection). */
  getNotesageSkillDescriptionsForPrompt: () => string;

  /** Get merged agent instructions concatenated by priority order. */
  getMergedAgentInstructions: () => string;

  /** Get Notesage-specific agent instructions only (for ACP injection). */
  getNotesageAgentInstructions: () => string;

  /** Scan for skills in the given base directories. */
  scanSkills: (baseDirs: string[]) => Promise<void>;

  /** Scan for agent instruction files. */
  scanAgentInstructions: (projectRoot: string | null, providers: string[]) => Promise<void>;

  /** Toggle a skill's enabled state. */
  toggleSkill: (skillPath: string, enabled: boolean) => void;

  /** Reset all user overrides. */
  resetOverrides: () => void;

  // --- Agent methods ---

  /** Get hierarchy-resolved agents (same-name: project > global > bundled > external). */
  getActiveAgents: () => AgentEntry[];

  /** Get user-invocable agents (filtered by user_invocable !== false and enabled). */
  getUserInvocableAgents: () => AgentEntry[];

  /** Get a specific agent by name from hierarchy-resolved agents. */
  getAgentByName: (name: string) => AgentEntry | undefined;

  /** Get the currently active agent entry. Falls back to general-assistant. */
  getActiveAgent: () => AgentEntry | undefined;

  /** Scan for addressable agent files. */
  scanAgents: (baseDirs: string[]) => Promise<void>;

  /** Set the active agent by name. */
  setActiveAgent: (name: string) => void;

  /** Toggle an agent's enabled state. */
  toggleAgent: (agentPath: string, enabled: boolean) => void;

  /** Request a rescan of skills/agents (bumps counter, observed by useSkillDiscovery). */
  requestRescan: () => void;
}

/** Known skill source labels. Must match Rust `determine_source` / `determine_agent_source` in commands/skills.rs. */
export type SkillSource = 'external' | 'agents' | 'gemini' | 'codex' | 'claude' | 'github' | 'notesage-global' | 'notesage-project';

/** Source priority for hierarchy resolution (higher = wins). */
export const SOURCE_PRIORITY: Record<SkillSource, number> = {
  'external': 1,
  'agents': 2,
  'gemini': 2,
  'codex': 2,
  'claude': 2,
  'github': 2,
  'notesage-global': 3,
  'notesage-project': 4,
};

function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source as SkillSource] ?? 1;
}

export const useSkillStore = create<SkillStore>()(
  persist(
    (set, get) => ({
      skills: [],
      enabledOverrides: {},
      agentInstructions: [],
      lastScanTimestamp: 0,
      isScanning: false,
      rescanCounter: 0,
      agents: [],
      activeAgentName: 'general-assistant',
      agentEnabledOverrides: {},

      getActiveSkills: () => {
        const { skills, enabledOverrides } = get();

        // Group by name, keep highest priority
        const byName = new Map<string, SkillEntry>();
        for (const skill of skills) {
          const existing = byName.get(skill.name);
          if (!existing || getSourcePriority(skill.source) > getSourcePriority(existing.source)) {
            byName.set(skill.name, skill);
          }
        }

        // Filter by enabled state
        return Array.from(byName.values()).filter((skill) => {
          const override = enabledOverrides[skill.path];
          // Default to enabled unless explicitly disabled
          return override !== false;
        });
      },

      getSkillByName: (name) => {
        return get().getActiveSkills().find((s) => s.name === name);
      },

      getSkillDescriptionsForPrompt: () => {
        const active = get().getActiveSkills();
        if (active.length === 0) return '';

        const lines = active.map(
          (s) => `- **${s.name}**: ${s.description}${s.has_scripts ? ' (has scripts)' : ''}`
        );
        return `\n\nAvailable skills:\n${lines.join('\n')}`;
      },

      getNotesageSkillDescriptionsForPrompt: () => {
        const active = get().getActiveSkills().filter(
          (s) => s.source === 'notesage-project' || s.source === 'notesage-global'
        );
        if (active.length === 0) return '';

        const lines = active.map(
          (s) => `- **${s.name}**: ${s.description}${s.has_scripts ? ' (has scripts)' : ''}`
        );
        return `\n\nNotesage skills:\n${lines.join('\n')}`;
      },

      getMergedAgentInstructions: () => {
        const { agentInstructions } = get();
        if (agentInstructions.length === 0) return '';

        return agentInstructions
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((i) => i.content)
          .join('\n\n');
      },

      getNotesageAgentInstructions: () => {
        const { agentInstructions } = get();
        const notesageOnly = agentInstructions.filter(
          (i) => i.source_type === 'notesage-project' || i.source_type === 'notesage-global'
        );
        if (notesageOnly.length === 0) return '';

        return notesageOnly
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((i) => i.content)
          .join('\n\n');
      },

      scanSkills: async (baseDirs) => {
        set({ isScanning: true });
        try {
          const skills = await tauriApi.discoverSkills(baseDirs);
          set({ skills, lastScanTimestamp: Date.now(), isScanning: false });
        } catch (e) {
          console.error('Skill discovery failed:', e);
          set({ isScanning: false });
        }
      },

      scanAgentInstructions: async (projectRoot, providers) => {
        try {
          const agentInstructions = await tauriApi.readAgentInstructions(projectRoot, providers);
          set({ agentInstructions });
        } catch (e) {
          console.error('Agent instruction discovery failed:', e);
        }
      },

      toggleSkill: (skillPath, enabled) =>
        set((state) => ({
          enabledOverrides: { ...state.enabledOverrides, [skillPath]: enabled },
        })),

      resetOverrides: () => set({ enabledOverrides: {} }),

      // --- Agent methods ---

      getActiveAgents: () => {
        const { agents, agentEnabledOverrides } = get();

        // Group by name, keep highest priority
        const byName = new Map<string, AgentEntry>();
        for (const agent of agents) {
          const existing = byName.get(agent.name);
          if (!existing || getSourcePriority(agent.source) > getSourcePriority(existing.source)) {
            byName.set(agent.name, agent);
          }
        }

        // Filter by enabled state
        return Array.from(byName.values()).filter((agent) => {
          const override = agentEnabledOverrides[agent.path];
          return override !== false;
        });
      },

      getUserInvocableAgents: () => {
        return get().getActiveAgents().filter((a) => a.user_invocable !== false);
      },

      getAgentByName: (name) => {
        return get().getActiveAgents().find((a) => a.name === name);
      },

      getActiveAgent: () => {
        const { activeAgentName } = get();
        const agent = get().getAgentByName(activeAgentName);
        if (agent) return agent;
        // Fallback to general-assistant
        return get().getAgentByName('general-assistant');
      },

      scanAgents: async (baseDirs) => {
        try {
          const agents = await tauriApi.discoverAgents(baseDirs);
          set({ agents });
        } catch (e) {
          console.error('Agent discovery failed:', e);
        }
      },

      setActiveAgent: (name) => set({ activeAgentName: name }),

      toggleAgent: (agentPath, enabled) =>
        set((state) => ({
          agentEnabledOverrides: { ...state.agentEnabledOverrides, [agentPath]: enabled },
        })),

      requestRescan: () => set((state) => ({ rescanCounter: state.rescanCounter + 1 })),
    }),
    {
      name: 'notesage-skills',
      partialize: (state) => ({
        enabledOverrides: state.enabledOverrides,
        activeAgentName: state.activeAgentName,
        agentEnabledOverrides: state.agentEnabledOverrides,
      }),
    }
  )
);
