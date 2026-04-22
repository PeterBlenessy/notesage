import { describe, it, expect, beforeEach } from 'vitest';
import { useSkillStore, SkillEntry, SkillToolEntry, AgentInstruction, BUILT_IN_TOOLS, parseSkillTokens } from '../skill-store';

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
      rescanCounter: 0,
      skillTools: [],
      agents: [],
      activeAgentName: 'general-assistant',
      agentEnabledOverrides: {},
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

  describe('BUILT_IN_TOOLS', () => {
    it('contains contains all built-in tools', () => {
      expect(BUILT_IN_TOOLS).toHaveLength(10);
    });

    it('has correct tool names', () => {
      const names = BUILT_IN_TOOLS.map((t) => t.name);
      expect(names).toEqual([
        'web_search', 'read_skill_content', 'execute_skill_script', 'list_directory', 'read_file', 'write_file',
        'add_comments', 'list_comments', 'resolve_comments', 'generate_pptx',
      ]);
    });

    it('each tool has name, description, and input_schema', () => {
      for (const tool of BUILT_IN_TOOLS) {
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect(tool.description.length).toBeGreaterThan(0);
        expect(tool.input_schema).toBeDefined();
        expect(tool.input_schema.type).toBe('object');
        expect(tool.input_schema.properties).toBeDefined();
        // Some tools (list_comments, generate_pptx) have no required fields
        if (tool.input_schema.required) {
          expect(Array.isArray(tool.input_schema.required)).toBe(true);
        }
      }
    });
  });

  describe('getToolDefinitions', () => {
    it('returns all built-in tools when no filter and no skill tools', () => {
      const tools = useSkillStore.getState().getToolDefinitions();
      expect(tools).toHaveLength(10);
    });

    it('includes skill tools alongside built-in tools', () => {
      useSkillStore.setState({
        skillTools: [makeSkillTool({ tool_name: 'skill__download_webpage' })],
      });

      const tools = useSkillStore.getState().getToolDefinitions();
      expect(tools).toHaveLength(11);
      expect(tools.map((t) => t.name)).toContain('skill__download_webpage');
    });

    it('filters by allowedTools list', () => {
      const tools = useSkillStore.getState().getToolDefinitions(['read_file']);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('read_file');
    });

    it('filters multiple allowed tools', () => {
      const tools = useSkillStore.getState().getToolDefinitions(['read_file', 'write_file']);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(['read_file', 'write_file']);
    });

    it('filters skill tools by exact name', () => {
      useSkillStore.setState({
        skillTools: [
          makeSkillTool({ tool_name: 'skill__download_webpage' }),
          makeSkillTool({ tool_name: 'skill__create_skill__scaffold' }),
        ],
      });

      const tools = useSkillStore.getState().getToolDefinitions(['skill__download_webpage']);
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('skill__download_webpage');
    });

    it('filters skill tools by skill name prefix', () => {
      useSkillStore.setState({
        skillTools: [
          makeSkillTool({ tool_name: 'skill__create_skill__scaffold', skill_name: 'create-skill' }),
          makeSkillTool({ tool_name: 'skill__create_skill__validate', skill_name: 'create-skill' }),
          makeSkillTool({ tool_name: 'skill__download_webpage', skill_name: 'download-webpage' }),
        ],
      });

      const tools = useSkillStore.getState().getToolDefinitions(['skill__create_skill']);
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual([
        'skill__create_skill__scaffold',
        'skill__create_skill__validate',
      ]);
    });

    it('returns empty array when no tools match', () => {
      const tools = useSkillStore.getState().getToolDefinitions(['nonexistent_tool']);
      expect(tools).toHaveLength(0);
    });

    it('returns empty array for empty allowedTools list', () => {
      const tools = useSkillStore.getState().getToolDefinitions([]);
      expect(tools).toHaveLength(0);
    });
  });

  describe('setSkillTools and getSkillToolByName', () => {
    it('stores and retrieves skill tools', () => {
      const tool = makeSkillTool({ tool_name: 'skill__my_tool' });
      useSkillStore.getState().setSkillTools([tool]);

      expect(useSkillStore.getState().skillTools).toHaveLength(1);
      expect(useSkillStore.getState().getSkillToolByName('skill__my_tool')).toBeDefined();
      expect(useSkillStore.getState().getSkillToolByName('nonexistent')).toBeUndefined();
    });
  });

  describe('getSkillDescriptionsForPrompt excludes tool-converted skills', () => {
    it('excludes skills that have tool definitions', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'download-webpage', source: 'notesage-global', description: 'Download pages', has_scripts: true }),
          skill({ name: 'knowledge-only', source: 'notesage-global', description: 'Just instructions' }),
        ],
        skillTools: [makeSkillTool({ skill_name: 'download-webpage' })],
      });

      const prompt = useSkillStore.getState().getSkillDescriptionsForPrompt();
      expect(prompt).not.toContain('download-webpage');
      expect(prompt).toContain('knowledge-only');
    });

    it('returns empty when all skills are tool-converted', () => {
      useSkillStore.setState({
        skills: [
          skill({ name: 'download-webpage', source: 'notesage-global', has_scripts: true }),
        ],
        skillTools: [makeSkillTool({ skill_name: 'download-webpage' })],
      });

      const prompt = useSkillStore.getState().getSkillDescriptionsForPrompt();
      expect(prompt).toBe('');
    });
  });
});

describe('parseSkillTokens', () => {
  it('matches a token at the start of the string', () => {
    expect(parseSkillTokens('/web-search now')).toEqual(['web-search']);
  });

  it('matches a token after whitespace anywhere in the message', () => {
    expect(parseSkillTokens('please run /web-search for me')).toEqual(['web-search']);
  });

  it('matches multiple tokens in document order', () => {
    expect(
      parseSkillTokens('do /web-search and /save-research'),
    ).toEqual(['web-search', 'save-research']);
  });

  it('does not match slashes inside URLs', () => {
    // Slashes here are preceded by alphanumerics, not whitespace.
    expect(parseSkillTokens('see https://example.com/path')).toEqual([]);
    expect(parseSkillTokens('look at github.com/owner/repo')).toEqual([]);
  });

  it('does not match numeric-only tokens', () => {
    // `/123` and `/9-skill` must not match — first char after `/` must be a letter.
    expect(parseSkillTokens('see issue /123')).toEqual([]);
    expect(parseSkillTokens('/9-skill should not match')).toEqual([]);
  });

  it('matches hyphenated names', () => {
    expect(parseSkillTokens('/web-search')).toEqual(['web-search']);
    expect(parseSkillTokens('hello /a-b-c-d world')).toEqual(['a-b-c-d']);
  });

  it('stops at trailing punctuation', () => {
    expect(parseSkillTokens('use /web-search.')).toEqual(['web-search']);
    expect(parseSkillTokens('/web-search!')).toEqual(['web-search']);
    expect(parseSkillTokens('/web-search, then /save')).toEqual(['web-search', 'save']);
  });

  it('does not match when preceded by non-whitespace punctuation', () => {
    // Documented limitation: leading `(` is not whitespace.
    expect(parseSkillTokens('(/web-search)')).toEqual([]);
  });

  it('matches after a Unicode non-breaking space', () => {
    // U+00A0 is part of `\s` in modern JS engines — verifies pasted-from-the-web
    // text doesn't silently fail to expand.
    expect(parseSkillTokens('text\u00a0/web-search')).toEqual(['web-search']);
  });

  it('does not match uppercase tokens', () => {
    // Skill names are lowercase by convention.
    expect(parseSkillTokens('/WebSearch')).toEqual([]);
    expect(parseSkillTokens('/Web-Search')).toEqual([]);
  });

  it('returns empty array for empty input', () => {
    expect(parseSkillTokens('')).toEqual([]);
  });

  it('returns empty array when no tokens are present', () => {
    expect(parseSkillTokens('just a normal sentence')).toEqual([]);
  });

  it('matches a token at the start of a new line', () => {
    expect(parseSkillTokens('first line\n/save-research')).toEqual(['save-research']);
  });

  it('matches a token after a tab', () => {
    expect(parseSkillTokens('\t/web-search')).toEqual(['web-search']);
  });

  it('preserves duplicates in the order the user typed them', () => {
    expect(
      parseSkillTokens('/web-search and again /web-search'),
    ).toEqual(['web-search', 'web-search']);
  });
});

// --- Test helpers ---

function makeSkillTool(overrides: Partial<SkillToolEntry> & { tool_name?: string }): SkillToolEntry {
  return {
    tool_name: overrides.tool_name ?? 'skill__test',
    description: 'A test tool',
    skill_name: 'test-skill',
    script_path: 'scripts/run.sh',
    parameters: { type: 'object', properties: {}, required: [] },
    arg_mapping: [],
    explicit_schema: false,
    ...overrides,
  };
}
