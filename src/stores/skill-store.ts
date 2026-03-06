import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';

// --- Types matching Rust structs ---

export interface SkillEntry {
  name: string;
  description: string;
  path: string;
  source: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowed_tools?: string[];
  user_invocable?: boolean;
  disable_model_invocation?: boolean;
  has_scripts: boolean;
  has_references: boolean;
}

export interface SkillContent {
  name: string;
  body: string;
  scripts: string[];
  references: string[];
  assets: string[];
}

export interface ScriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

export interface AgentInstruction {
  source: string;
  source_type: string;
  content: string;
  priority: number;
}

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
}

/** Source priority for hierarchy resolution (higher = wins). */
const SOURCE_PRIORITY: Record<string, number> = {
  'bundled': 0,
  'external': 1,
  'agents': 2,
  'gemini': 2,
  'codex': 2,
  'claude': 2,
  'notesage-global': 3,
  'notesage-project': 4,
};

function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? 1;
}

export const useSkillStore = create<SkillStore>()(
  persist(
    (set, get) => ({
      skills: [],
      enabledOverrides: {},
      agentInstructions: [],
      lastScanTimestamp: 0,
      isScanning: false,

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
          (s) => s.source === 'notesage-project' || s.source === 'notesage-global' || s.source === 'bundled'
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
          const skills = await invoke<SkillEntry[]>('discover_skills', { baseDirs });
          set({ skills, lastScanTimestamp: Date.now(), isScanning: false });
        } catch (e) {
          console.error('Skill discovery failed:', e);
          set({ isScanning: false });
        }
      },

      scanAgentInstructions: async (projectRoot, providers) => {
        try {
          const agentInstructions = await invoke<AgentInstruction[]>(
            'read_agent_instructions',
            { projectRoot, connectedProviders: providers }
          );
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
    }),
    {
      name: 'notesage-skills',
      partialize: (state) => ({ enabledOverrides: state.enabledOverrides }),
    }
  )
);
