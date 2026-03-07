import { describe, it, expect, beforeEach } from 'vitest';
import { useSkillStore, SkillEntry, AgentInstruction } from '../skill-store';

// Helper to create a SkillEntry
function skill(overrides: Partial<SkillEntry> & { name: string; source: string }): SkillEntry {
  return {
    description: '',
    path: `/skills/${overrides.source}/${overrides.name}`,
    has_scripts: false,
    has_references: false,
    ...overrides,
  };
}

function instruction(overrides: Partial<AgentInstruction> & { source_type: string; priority: number }): AgentInstruction {
  return {
    source: `/path/${overrides.source_type}`,
    content: `Instructions from ${overrides.source_type}`,
    ...overrides,
  };
}

describe('skill-store', () => {
  beforeEach(() => {
    // Reset store state before each test
    useSkillStore.setState({
      skills: [],
      enabledOverrides: {},
      agentInstructions: [],
      lastScanTimestamp: 0,
      isScanning: false,
    });
  });

  describe('getActiveSkills', () => {
    it('returns all skills when no overrides', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'web-research', source: 'notesage-project' }),
          skill({ name: 'code-review', source: 'claude' }),
        ],
      });

      const active = useSkillStore.getState().getActiveSkills();
      expect(active).toHaveLength(2);
    });

    it('resolves hierarchy: project overrides global overrides external', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'code-review', source: 'claude', description: 'from claude' }),
          skill({ name: 'code-review', source: 'notesage-global', description: 'from global' }),
          skill({ name: 'code-review', source: 'notesage-project', description: 'from project' }),
        ],
      });

      const active = useSkillStore.getState().getActiveSkills();
      expect(active).toHaveLength(1);
      expect(active[0].description).toBe('from project');
      expect(active[0].source).toBe('notesage-project');
    });

    it('global overrides external provider', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'my-skill', source: 'codex', description: 'from codex' }),
          skill({ name: 'my-skill', source: 'notesage-global', description: 'from global' }),
        ],
      });

      const active = useSkillStore.getState().getActiveSkills();
      expect(active).toHaveLength(1);
      expect(active[0].source).toBe('notesage-global');
    });

    it('excludes explicitly disabled skills', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'enabled-skill', source: 'claude' }),
          skill({ name: 'disabled-skill', source: 'claude' }),
        ],
        enabledOverrides: {
          '/skills/claude/disabled-skill': false,
        },
      });

      const active = useSkillStore.getState().getActiveSkills();
      expect(active).toHaveLength(1);
      expect(active[0].name).toBe('enabled-skill');
    });

    it('keeps different-named skills from same source', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'skill-a', source: 'claude' }),
          skill({ name: 'skill-b', source: 'claude' }),
        ],
      });

      const active = useSkillStore.getState().getActiveSkills();
      expect(active).toHaveLength(2);
    });
  });

  describe('getSkillByName', () => {
    it('finds a skill by name from active skills', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'web-research', source: 'notesage-project', description: 'Downloads pages' }),
        ],
      });

      const found = useSkillStore.getState().getSkillByName('web-research');
      expect(found).toBeDefined();
      expect(found?.description).toBe('Downloads pages');
    });

    it('returns undefined for non-existent skill', () => {
      const found = useSkillStore.getState().getSkillByName('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('getSkillDescriptionsForPrompt', () => {
    it('returns empty string when no skills', () => {
      expect(useSkillStore.getState().getSkillDescriptionsForPrompt()).toBe('');
    });

    it('formats active skills as markdown list', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'web-research', source: 'claude', description: 'Downloads web pages', has_scripts: true }),
          skill({ name: 'code-review', source: 'claude', description: 'Reviews code' }),
        ],
      });

      const prompt = useSkillStore.getState().getSkillDescriptionsForPrompt();
      expect(prompt).toContain('Available skills:');
      expect(prompt).toContain('**web-research**: Downloads web pages (has scripts)');
      expect(prompt).toContain('**code-review**: Reviews code');
      // No "(has scripts)" for code-review
      expect(prompt).not.toContain('Reviews code (has scripts)');
    });
  });

  describe('getNotesageSkillDescriptionsForPrompt', () => {
    it('only includes notesage and bundled skills', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'external-skill', source: 'claude', description: 'From Claude' }),
          skill({ name: 'project-skill', source: 'notesage-project', description: 'From project' }),
          skill({ name: 'global-skill', source: 'notesage-global', description: 'Global' }),
        ],
      });

      const prompt = useSkillStore.getState().getNotesageSkillDescriptionsForPrompt();
      expect(prompt).toContain('project-skill');
      expect(prompt).toContain('global-skill');
      expect(prompt).not.toContain('external-skill');
    });
  });

  describe('getMergedAgentInstructions', () => {
    it('returns empty string when no instructions', () => {
      expect(useSkillStore.getState().getMergedAgentInstructions()).toBe('');
    });

    it('concatenates instructions sorted by priority (ascending)', () => {
      useSkillStore.setState({
        agentInstructions: [
          instruction({ source_type: 'notesage-project', priority: 5, content: 'Project rules' }),
          instruction({ source_type: 'agents-md', priority: 1, content: 'Base rules' }),
          instruction({ source_type: 'notesage-global', priority: 4, content: 'Global rules' }),
        ],
      });

      const merged = useSkillStore.getState().getMergedAgentInstructions();
      const parts = merged.split('\n\n');
      expect(parts[0]).toBe('Base rules');
      expect(parts[1]).toBe('Global rules');
      expect(parts[2]).toBe('Project rules');
    });
  });

  describe('getNotesageAgentInstructions', () => {
    it('only includes notesage-project and notesage-global', () => {
      useSkillStore.setState({
        agentInstructions: [
          instruction({ source_type: 'agents-md', priority: 1, content: 'External' }),
          instruction({ source_type: 'claude-md', priority: 2, content: 'Claude' }),
          instruction({ source_type: 'notesage-global', priority: 4, content: 'Global' }),
          instruction({ source_type: 'notesage-project', priority: 5, content: 'Project' }),
        ],
      });

      const merged = useSkillStore.getState().getNotesageAgentInstructions();
      expect(merged).toContain('Global');
      expect(merged).toContain('Project');
      expect(merged).not.toContain('External');
      expect(merged).not.toContain('Claude');
    });
  });

  describe('toggleSkill', () => {
    it('sets enabled override for a skill path', () => {
      useSkillStore.getState().toggleSkill('/path/to/skill', false);
      expect(useSkillStore.getState().enabledOverrides['/path/to/skill']).toBe(false);

      useSkillStore.getState().toggleSkill('/path/to/skill', true);
      expect(useSkillStore.getState().enabledOverrides['/path/to/skill']).toBe(true);
    });
  });

  describe('resetOverrides', () => {
    it('clears all overrides', () => {
      useSkillStore.setState({
        enabledOverrides: { '/a': false, '/b': true },
      });
      useSkillStore.getState().resetOverrides();
      expect(useSkillStore.getState().enabledOverrides).toEqual({});
    });
  });
});
