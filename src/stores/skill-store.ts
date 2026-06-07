import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tauriApi } from '@/lib/tauri';
import type {
  SkillEntry as TauriSkillEntry,
  SkillToolEntry,
  AgentInstruction as TauriAgentInstruction,
  AgentEntry as TauriAgentEntry,
} from '@/lib/tauri';
import type { ToolDefinition } from '@/lib/ai/types';
import { log } from '@/lib/logger';


// Re-export types from tauri.ts for consumers that import from skill-store
export type { SkillToolEntry, SkillContent, ScriptResult, AgentContent } from '@/lib/tauri';
export type { ArgMapping, ArgMappingType } from '@/lib/tauri';
export type { ToolDefinition } from '@/lib/ai/types';

// Augment backend-sourced entries with an optional `projectRoot` the store
// attaches at scan time. Null/undefined = global (not project-scoped). Scoped
// getters filter on this field against `selectedProjectPaths` to honour
// per-project isolation (Task #18).
export type SkillEntry = TauriSkillEntry & { projectRoot?: string | null };
export type AgentEntry = TauriAgentEntry & { projectRoot?: string | null };
export type AgentInstruction = TauriAgentInstruction & { projectRoot?: string | null };

// --- Skill-token parser (Phase 1, task #22) ---
//
// Frontend mirror of the Rust `parse_skill_tokens` helper in
// `src-tauri/src/commands/skills_tool_parser.rs`. Used by the new Quiet
// Composer UX to preview / autocomplete `/skill-name` tokens that may appear
// anywhere in a user message — at start-of-string OR after any whitespace
// character.
//
// SCOPE / CALL-SITE NOTES:
// - This parser is for the **direct-API** send path only.
// - The **ACP pass-through** path forwards user messages verbatim (the
//   provider manages its own subagent / slash-command system). Do NOT call
//   `parseSkillTokens` from ACP code paths.
//
// PATTERN: `(?:^|\s)/[a-z][a-z0-9-]*`
//   - Anchor: start-of-string or any Unicode whitespace (`\s` in modern JS
//     engines includes U+00A0 non-breaking space and other Unicode space
//     separators).
//   - Slash + first char must be a lowercase letter (avoids `/123` numeric
//     false positives, AI-generated paths, and URL fragments).
//   - Body: lowercase letters, digits, hyphens (matches Notesage skill
//     naming convention).
//
// KNOWN LIMITATIONS (covered by tests):
//   - URLs like `https://example.com/path` do NOT match.
//   - `(/web-search)` does NOT match — leading `(` is not whitespace.
//   - Trailing punctuation (`.`, `,`, `!`, `?`) terminates the token cleanly.
const SKILL_TOKEN_RE = /(?:^|\s)\/([a-z][a-z0-9-]*)/g;

/**
 * Parse a user message and return the names of every `/skill-name` token
 * found, in document order. Returns an empty array if no tokens are found.
 *
 * Names are returned without the leading slash. Duplicates are preserved
 * (the order/count reflects the user's input verbatim).
 */
export function parseSkillTokens(text: string): string[] {
  if (!text) return [];
  // `matchAll` requires the `g` flag, which our regex has.
  const out: string[] = [];
  for (const m of text.matchAll(SKILL_TOKEN_RE)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

// --- Built-in tools for local AI tool calling ---

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Returns titles, URLs, and snippets from search results.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_skill_content',
    description: 'Load the full instructions and file listing of a skill. Call this when you need detailed instructions for using a skill.',
    input_schema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string', description: 'Name of the skill to load' },
      },
      required: ['skill_name'],
    },
  },
  {
    name: 'execute_skill_script',
    description: 'Execute a script from a skill directory. Returns stdout, stderr, and exit code.',
    input_schema: {
      type: 'object',
      properties: {
        skill_name: { type: 'string', description: 'Name of the skill' },
        script: { type: 'string', description: 'Relative path to script (e.g., "scripts/download.py")' },
        args: { type: 'array', items: { type: 'string' }, description: 'Arguments for the script' },
      },
      required: ['skill_name', 'script'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and folders in a directory. Use this to discover what files exist before reading them. Returns names with "/" suffix for directories.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the directory to list' },
      },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description: 'Read a file from the filesystem. Returns file contents as text.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file if it does not exist.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path to the file' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'add_comments',
    description: 'Add inline comments to a document. Each comment is anchored to a specific text passage. The comments appear as highlighted decorations in the editor. Works on the active document or any file by path.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file to comment on. If omitted, uses the currently active document.' },
        comments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              anchor_text: { type: 'string', description: 'The exact text passage to attach the comment to. Must be a verbatim substring of the document.' },
              body: { type: 'string', description: 'The comment text.' },
              occurrence: { type: 'number', description: 'Which occurrence of the anchor text to use (1-based). Defaults to 1.' },
            },
            required: ['anchor_text', 'body'],
          },
          description: 'Array of comments to add.',
        },
      },
      required: ['comments'],
    },
  },
  {
    name: 'list_comments',
    description: 'List all comments on a document. Returns comment text, status, anchor text, and replies. Works on the active document or any file by path.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file. If omitted, uses the currently active document.' },
      },
    },
  },
  {
    name: 'resolve_comments',
    description: 'Mark one or more comments as resolved. Use after modifying the document to address the issues described in the comments. Works on the active document or any file by path.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Absolute path to the file. If omitted, uses the currently active document.' },
        comment_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of comment IDs to resolve. Use list_comments to get the IDs.',
        },
      },
      required: ['comment_ids'],
    },
  },
  {
    name: 'generate_pptx',
    description: 'Generate a PowerPoint presentation from the currently active document or from provided markdown content. If no template is specified, ask the user which template they prefer before calling this tool.',
    input_schema: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          description: 'Template name: "simple", "business", "report", or a custom template name.',
        },
        output_path: {
          type: 'string',
          description: 'Absolute path for the output .pptx file. If omitted, saves next to the source document with .pptx extension.',
        },
        markdown: {
          type: 'string',
          description: 'Optional markdown content. If omitted, uses the currently active document.',
        },
      },
    },
  },
];

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

  /** Tool definitions extracted from script-bearing skills (rebuilt from scan, not persisted). */
  skillTools: SkillToolEntry[];

  // --- Agent state ---

  /** All discovered addressable agents (rebuilt from scan, not persisted). */
  agents: AgentEntry[];

  /** Currently active agent name. Persisted. */
  activeAgentName: string;

  /** User overrides for agent enabled state (agent path → enabled). Persisted. */
  agentEnabledOverrides: Record<string, boolean>;

  // --- Skill methods ---

  /**
   * Get active skills: enabled, respecting hierarchy (same-name: project > global > external).
   *
   * If `selectedProjectPaths` is provided, project-scoped skills are filtered
   * to only those matching. Global skills are always included. If omitted,
   * all skills are returned (back-compat for UI display). System-prompt callers
   * must always pass an explicit array to opt into isolation.
   */
  getActiveSkills: (selectedProjectPaths?: string[]) => SkillEntry[];

  /** Get a skill by name from active skills (unscoped — back-compat). */
  getSkillByName: (name: string) => SkillEntry | undefined;

  /**
   * Format active skill descriptions for AI system message injection.
   * Scoped to `selectedProjectPaths` — project A's skills do not leak into project B.
   */
  getSkillDescriptionsForPrompt: (selectedProjectPaths?: string[]) => string;

  /** Get Notesage-specific skill descriptions only (for ACP injection), scoped. */
  getNotesageSkillDescriptionsForPrompt: (selectedProjectPaths?: string[]) => string;

  /**
   * Get merged agent instructions concatenated by priority order.
   * Scoped to `selectedProjectPaths` — project A's CLAUDE.md/AGENTS.md do not leak into project B.
   */
  getMergedAgentInstructions: (selectedProjectPaths?: string[]) => string;

  /** Get Notesage-specific agent instructions only (for ACP injection), scoped. */
  getNotesageAgentInstructions: (selectedProjectPaths?: string[]) => string;

  /**
   * Scan for skills. Accepts a legacy flat array (all entries treated as global)
   * or a per-project form that annotates entries with their projectRoot.
   */
  scanSkills: (
    input: string[] | { globalDirs: string[]; byProject: Record<string, string[]> },
  ) => Promise<void>;

  /**
   * Scan for agent instruction files. Pass zero or more project roots plus the
   * active provider list. Project-scoped entries are annotated with their root
   * so scoped getters can filter.
   */
  scanAgentInstructions: (projectRoots: string[], providers: string[]) => Promise<void>;

  /** Toggle a skill's enabled state. */
  toggleSkill: (skillPath: string, enabled: boolean) => void;

  /** Reset all user overrides. */
  resetOverrides: () => void;

  // --- Agent methods ---

  /**
   * Get hierarchy-resolved agents (same-name: project > global > bundled > external).
   * Scoped: when `selectedProjectPaths` is provided, project-scoped agents are
   * filtered to only those matching. If omitted, returns all (back-compat for UI).
   */
  getActiveAgents: (selectedProjectPaths?: string[]) => AgentEntry[];

  /** Get user-invocable agents (filtered by user_invocable !== false and enabled). */
  getUserInvocableAgents: (selectedProjectPaths?: string[]) => AgentEntry[];

  /** Get a specific agent by name from hierarchy-resolved agents. */
  getAgentByName: (name: string) => AgentEntry | undefined;

  /** Get the currently active agent entry. Falls back to general-assistant. */
  getActiveAgent: () => AgentEntry | undefined;

  /** Scan for addressable agent files. Accepts legacy flat or per-project form. */
  scanAgents: (
    input: string[] | { globalDirs: string[]; byProject: Record<string, string[]> },
  ) => Promise<void>;

  /** Set the active agent by name. */
  setActiveAgent: (name: string) => void;

  /** Toggle an agent's enabled state. */
  toggleAgent: (agentPath: string, enabled: boolean) => void;

  /** Request a rescan of skills/agents (bumps counter, observed by useSkillDiscovery). */
  requestRescan: () => void;

  /** Update skill tools (called after skill extraction). */
  setSkillTools: (tools: SkillToolEntry[]) => void;

  /** Get a skill tool entry by tool name. */
  getSkillToolByName: (toolName: string) => SkillToolEntry | undefined;

  /** Get tool definitions for local AI tool calling, optionally filtered by allowed tool names. */
  getToolDefinitions: (allowedTools?: string[]) => ToolDefinition[];
}

/** Known skill source labels. Must match Rust `determine_source` / `determine_agent_source` in commands/skills.rs. */
export type SkillSource = 'external' | 'agents' | 'gemini' | 'codex' | 'claude' | 'github' | 'copilot' | 'notesage-global' | 'notesage-project';

/** Source priority for hierarchy resolution (higher = wins). */
export const SOURCE_PRIORITY: Record<SkillSource, number> = {
  'external': 1,
  'agents': 2,
  'gemini': 2,
  'codex': 2,
  'claude': 2,
  'github': 2,
  'copilot': 2,
  'notesage-global': 3,
  'notesage-project': 4,
};

function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source as SkillSource] ?? 1;
}

/**
 * Collapse a skill source label to the low-cardinality telemetry `ItemSource`
 * (`bundled | user | project`). Project skills report `project`; every other
 * source (global Notesage skills + external provider skills) is `user`.
 * Pure — no PII.
 */
export function skillSourceToItemSource(
  source: string,
): 'bundled' | 'user' | 'project' {
  return source === 'notesage-project' ? 'project' : 'user';
}

/**
 * Filter entries by project scope for Task #18 isolation.
 *
 * - Entries with `projectRoot == null` (or unannotated, legacy) are treated as
 *   global and always included.
 * - Entries with a `projectRoot` string are included only if that root is in
 *   `selectedProjectPaths`.
 * - When `selectedProjectPaths` is `undefined` (back-compat for UI callers),
 *   no scoping is applied. System-prompt callers must always pass an explicit
 *   (possibly empty) array to opt into isolation.
 */
function filterByScope<T extends { projectRoot?: string | null }>(
  entries: T[],
  selectedProjectPaths: string[] | undefined,
): T[] {
  if (selectedProjectPaths === undefined) return entries;
  const selected = new Set(selectedProjectPaths);
  return entries.filter((e) => {
    if (e.projectRoot == null) return true; // global
    return selected.has(e.projectRoot);
  });
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
      skillTools: [],
      agents: [],
      activeAgentName: '',
      agentEnabledOverrides: {},

      getActiveSkills: (selectedProjectPaths) => {
        const { skills, enabledOverrides } = get();
        const scoped = filterByScope(skills, selectedProjectPaths);

        // Group by name, keep highest priority
        const byName = new Map<string, SkillEntry>();
        for (const skill of scoped) {
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

      getSkillDescriptionsForPrompt: (selectedProjectPaths) => {
        const active = get().getActiveSkills(selectedProjectPaths);
        if (active.length === 0) return '';

        // Exclude skills that have been converted to tools (they're in the tools array now)
        const toolSkillNames = new Set(get().skillTools.map((t) => t.skill_name));
        const instructionOnly = active.filter((s) => !toolSkillNames.has(s.name));

        if (instructionOnly.length === 0) return '';

        const lines = instructionOnly.map(
          (s) => `- **${s.name}**: ${s.description}${s.has_scripts ? ' (has scripts)' : ''}`
        );
        return `\n\nAvailable skills:\n${lines.join('\n')}`;
      },

      getNotesageSkillDescriptionsForPrompt: (selectedProjectPaths) => {
        const active = get().getActiveSkills(selectedProjectPaths).filter(
          (s) => s.source === 'notesage-project' || s.source === 'notesage-global'
        );
        if (active.length === 0) return '';

        const lines = active.map(
          (s) => `- **${s.name}** (${s.path}/SKILL.md): ${s.description}${s.has_scripts ? ' — has executable scripts in scripts/' : ''}`
        );
        return `\n\n<notesage-skills>\nThe user has Notesage skills installed. To use a skill, read its SKILL.md file for instructions.\n\n${lines.join('\n')}\n</notesage-skills>`;
      },

      getMergedAgentInstructions: (selectedProjectPaths) => {
        const { agentInstructions } = get();
        const scoped = filterByScope(agentInstructions, selectedProjectPaths);
        if (scoped.length === 0) return '';

        return scoped
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((i) => i.content)
          .join('\n\n');
      },

      getNotesageAgentInstructions: (selectedProjectPaths) => {
        const { agentInstructions } = get();
        const scoped = filterByScope(agentInstructions, selectedProjectPaths);
        const notesageOnly = scoped.filter(
          (i) => i.source_type === 'notesage-project' || i.source_type === 'notesage-global'
        );
        if (notesageOnly.length === 0) return '';

        return notesageOnly
          .slice()
          .sort((a, b) => a.priority - b.priority)
          .map((i) => i.content)
          .join('\n\n');
      },

      scanSkills: async (input) => {
        set({ isScanning: true });
        try {
          // Legacy flat-array form → treat all as global (no project annotation).
          if (Array.isArray(input)) {
            const skills = await tauriApi.discoverSkills(input);
            set({ skills, lastScanTimestamp: Date.now(), isScanning: false });
            return;
          }

          // Per-project form: scan global + each project separately, annotate projectRoot.
          const { globalDirs, byProject } = input;
          const globalSkills = globalDirs.length > 0 ? await tauriApi.discoverSkills(globalDirs) : [];
          const projectSkills: SkillEntry[] = [];
          for (const [projectRoot, dirs] of Object.entries(byProject)) {
            if (dirs.length === 0) continue;
            const discovered = await tauriApi.discoverSkills(dirs);
            for (const s of discovered) {
              projectSkills.push({ ...s, projectRoot });
            }
          }
          // Annotate global explicitly with null so `filterByScope` treats as global.
          const annotatedGlobal: SkillEntry[] = globalSkills.map((s) => ({ ...s, projectRoot: null }));
          set({
            skills: [...annotatedGlobal, ...projectSkills],
            lastScanTimestamp: Date.now(),
            isScanning: false,
          });
        } catch (e) {
          log.error('skills', `Skill discovery failed`, e);
          set({ isScanning: false });
        }
      },

      scanAgentInstructions: async (projectRoots, providers) => {
        try {
          const all: AgentInstruction[] = [];
          // Always run once with projectRoot=null to pick up the global
          // ~/.notesage/agents.md. Project-scoped instructions get their
          // projectRoot annotation in the per-project pass below.
          const globalOnly = await tauriApi.readAgentInstructions(null, providers);
          for (const i of globalOnly) all.push({ ...i, projectRoot: null });

          for (const root of projectRoots) {
            if (!root) continue;
            const perProject = await tauriApi.readAgentInstructions(root, providers);
            for (const i of perProject) {
              // Skip the global entry the backend always includes; we already
              // captured it in the null-root pass above.
              if (i.source_type === 'notesage-global') continue;
              all.push({ ...i, projectRoot: root });
            }
          }
          set({ agentInstructions: all });
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

      getActiveAgents: (selectedProjectPaths) => {
        const { agents, agentEnabledOverrides } = get();
        const scoped = filterByScope(agents, selectedProjectPaths);

        // Group by name, keep highest priority
        const byName = new Map<string, AgentEntry>();
        for (const agent of scoped) {
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

      getUserInvocableAgents: (selectedProjectPaths) => {
        return get().getActiveAgents(selectedProjectPaths).filter((a) => a.user_invocable !== false);
      },

      getAgentByName: (name) => {
        return get().getActiveAgents().find((a) => a.name === name);
      },

      getActiveAgent: () => {
        const { activeAgentName } = get();
        if (!activeAgentName) return undefined;
        return get().getAgentByName(activeAgentName);
      },

      scanAgents: async (input) => {
        try {
          if (Array.isArray(input)) {
            const agents = await tauriApi.discoverAgents(input);
            set({ agents });
            return;
          }

          const { globalDirs, byProject } = input;
          const globalAgents = globalDirs.length > 0 ? await tauriApi.discoverAgents(globalDirs) : [];
          const projectAgents: AgentEntry[] = [];
          for (const [projectRoot, dirs] of Object.entries(byProject)) {
            if (dirs.length === 0) continue;
            const discovered = await tauriApi.discoverAgents(dirs);
            for (const a of discovered) {
              projectAgents.push({ ...a, projectRoot });
            }
          }
          const annotatedGlobal: AgentEntry[] = globalAgents.map((a) => ({ ...a, projectRoot: null }));
          set({ agents: [...annotatedGlobal, ...projectAgents] });
        } catch (e) {
          log.error('skills', `Agent discovery failed`, e);
        }
      },

      setActiveAgent: (name) => set({ activeAgentName: name }),

      toggleAgent: (agentPath, enabled) =>
        set((state) => ({
          agentEnabledOverrides: { ...state.agentEnabledOverrides, [agentPath]: enabled },
        })),

      requestRescan: () => set((state) => ({ rescanCounter: state.rescanCounter + 1 })),

      setSkillTools: (tools) => set({ skillTools: tools }),

      getSkillToolByName: (toolName) => {
        return get().skillTools.find((t) => t.tool_name === toolName);
      },

      getToolDefinitions: (allowedTools?: string[]) => {
        // Convert skill tools to ToolDefinition format
        const skillToolDefs: ToolDefinition[] = get().skillTools.map((st) => ({
          name: st.tool_name,
          description: st.description,
          input_schema: st.parameters as Record<string, unknown>,
        }));

        const allTools = [...BUILT_IN_TOOLS, ...skillToolDefs];

        if (!allowedTools) return allTools;

        return allTools.filter((tool) => {
          // Match on exact tool name
          if (allowedTools.includes(tool.name)) return true;
          // For skill tools, also match on the skill name prefix (e.g., "skill__download_webpage")
          if (tool.name.startsWith('skill__')) {
            const parts = tool.name.split('__');
            const skillPrefix = parts.length >= 2 ? `skill__${parts[1]}` : '';
            return allowedTools.includes(skillPrefix);
          }
          return false;
        });
      },
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
