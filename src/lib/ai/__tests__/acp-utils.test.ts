import { describe, it, expect, expectTypeOf, beforeEach } from 'vitest';
import {
  formatToolLabel,
  parseRawInput,
  normalizeToolCallContent,
  hasSessionCapability,
  getChatSandboxScope,
  buildAttachmentActivities,
  type AcpAgentCapabilities,
  type AcpSpawnResult,
  type AuthEnvVar,
  type AuthMethodInfo,
} from '../acp-utils';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Connection } from '@/lib/ai/connections';

describe('formatToolLabel', () => {
  it('formats read_file with path basename', () => {
    expect(formatToolLabel('read_file', { path: '/src/lib/config.ts' })).toBe('Reading config.ts');
    expect(formatToolLabel('read', { path: '/src/App.tsx' })).toBe('Reading App.tsx');
  });

  it('formats write/edit with path basename', () => {
    expect(formatToolLabel('write_file', { path: '/src/App.tsx' })).toBe('Editing App.tsx');
    expect(formatToolLabel('write', { path: '/src/App.tsx' })).toBe('Editing App.tsx');
    expect(formatToolLabel('edit', { file_path: '/src/App.tsx' })).toBe('Editing App.tsx');
  });

  it('formats bash with truncated command', () => {
    expect(formatToolLabel('bash', { command: 'npm test --watch src/' })).toBe(
      'Running: npm test --watch src/',
    );
    const longCmd =
      'npm run test -- --coverage --reporter=verbose --config=vitest.config.ts --watch src/components/';
    const result = formatToolLabel('bash', { command: longCmd });
    expect(result.length).toBeLessThanOrEqual(70); // "Running: " + 60 + "…"
    expect(result).toContain('\u2026');
  });

  it('formats glob/list with pattern or directory', () => {
    expect(formatToolLabel('glob', { pattern: 'src/components/' })).toBe(
      'Searching src/components/',
    );
    expect(formatToolLabel('list_directory', { path: '/Users/me/project/src' })).toBe(
      'Searching src',
    );
    expect(formatToolLabel('list', { directory: '/Users/me/project/lib' })).toBe('Searching lib');
  });

  it('formats grep with quoted query', () => {
    expect(formatToolLabel('grep', { pattern: 'useState' })).toBe('Searching for "useState"');
  });

  it('formats web_search with quoted query', () => {
    expect(formatToolLabel('web_search', { query: 'React 19 changes' })).toBe(
      'Searching web: "React 19 changes"',
    );
  });

  it('formats fetch with domain', () => {
    expect(formatToolLabel('fetch', { url: 'https://github.com/foo/bar' })).toBe(
      'Fetching github.com',
    );
  });

  it('formats fetch with invalid URL gracefully', () => {
    expect(formatToolLabel('fetch', { url: 'not-a-url' })).toBe('Fetching not-a-url');
  });

  it('formats execute_skill_script', () => {
    expect(formatToolLabel('execute_skill_script', { skill: 'download-webpage' })).toBe(
      'Skill (download-webpage)',
    );
  });

  it('formats read_skill_content', () => {
    expect(formatToolLabel('read_skill_content', { skill: 'create-skill' })).toBe(
      'Loading skill: create-skill',
    );
  });

  it('falls back to kind for unknown tools', () => {
    expect(formatToolLabel('some_mcp_tool', {})).toBe('some_mcp_tool');
  });

  it('falls back to "Working" when no kind', () => {
    expect(formatToolLabel('', {})).toBe('Working');
  });

  it('falls back to generic label when args missing', () => {
    expect(formatToolLabel('read_file')).toBe('Reading file');
    expect(formatToolLabel('bash')).toBe('Running command');
    expect(formatToolLabel('web_search', {})).toBe('Searching the web');
  });

  it('truncates long search queries at ~40 chars', () => {
    const longQuery =
      'a very long search query that exceeds the forty character limit for display';
    const result = formatToolLabel('grep', { pattern: longQuery });
    expect(result).toContain('\u2026');
    // "Searching for " (15) + quote (1) + 40 + ellipsis (1) + quote (1) = 58
    expect(result.length).toBeLessThanOrEqual(58);
  });

  it('handles file_path as alternative to path', () => {
    expect(formatToolLabel('read_file', { file_path: '/foo/bar.ts' })).toBe('Reading bar.ts');
  });

  it('handles terminal as alias for bash', () => {
    expect(formatToolLabel('terminal', { command: 'ls -la' })).toBe('Running: ls -la');
  });

  it('handles cmd as alternative to command for bash', () => {
    expect(formatToolLabel('bash', { cmd: 'echo hello' })).toBe('Running: echo hello');
  });

  it('handles search_query as alternative for web_search', () => {
    expect(formatToolLabel('web_search', { search_query: 'test query' })).toBe(
      'Searching web: "test query"',
    );
  });

  it('handles name as alternative for skill operations', () => {
    expect(formatToolLabel('execute_skill_script', { name: 'my-skill' })).toBe(
      'Skill (my-skill)',
    );
    expect(formatToolLabel('read_skill_content', { name: 'my-skill' })).toBe(
      'Loading skill: my-skill',
    );
  });

  // ACP-specific kinds
  it('handles "execute" as bash alias (ACP)', () => {
    expect(formatToolLabel('execute', { command: 'npm test' })).toBe('Running: npm test');
  });

  it('handles "search" as grep alias (ACP)', () => {
    expect(formatToolLabel('search', { query: 'useState' })).toBe('Searching for "useState"');
  });

  it('handles "think" kind (ACP)', () => {
    expect(formatToolLabel('think', {})).toBe('Thinking');
    expect(formatToolLabel('think', {}, 'Planning approach')).toBe('Thinking: Planning approach');
  });

  it('handles "webfetch" / "web_fetch" as fetch alias', () => {
    expect(formatToolLabel('webfetch', { url: 'https://example.com/page' })).toBe('Fetching example.com');
    expect(formatToolLabel('web_fetch', { url: 'https://github.com/repo' })).toBe('Fetching github.com');
  });

  // Title fallback
  it('uses title as fallback when args are missing', () => {
    expect(formatToolLabel('read', {}, 'config.ts')).toBe('Reading config.ts');  // title used with verb prefix
    expect(formatToolLabel('read', {}, '/src/config.ts')).toBe('Reading config.ts');  // title with / used
    expect(formatToolLabel('execute', {}, 'npm run build')).toBe('Running: npm run build');
    expect(formatToolLabel('fetch', {}, 'https://api.example.com')).toBe('Fetching api.example.com');
  });

  it('uses title for unknown kinds', () => {
    expect(formatToolLabel('some_mcp_tool', {}, 'Doing something useful')).toBe('Doing something useful');
  });

  // URL scanning from arg values
  it('finds URL in arg values for fetch', () => {
    expect(formatToolLabel('fetch', { input: 'https://docs.rs/tokio' })).toBe('Fetching docs.rs');
  });

  // Path scanning from arg values
  it('finds file path in arg values for read', () => {
    expect(formatToolLabel('read', { input: '/Users/me/project/src/main.rs' })).toBe('Reading main.rs');
  });

  // effectiveTitle filtering
  it('filters title that equals the kind name', () => {
    expect(formatToolLabel('fetch', {}, 'Fetch')).toBe('Fetching resource');
    expect(formatToolLabel('fetch', {}, 'fetch')).toBe('Fetching resource');
  });

  it('filters "Task" as title for think kind', () => {
    expect(formatToolLabel('think', {}, 'Task')).toBe('Thinking');
  });

  it('uses title when it differs from kind', () => {
    expect(formatToolLabel('fetch', {}, 'https://example.com')).toBe('Fetching example.com');
    expect(formatToolLabel('think', {}, 'Planning the approach')).toBe('Thinking: Planning the approach');
  });

  // Skill kind alias
  it('handles "skill" as ACP kind alias', () => {
    expect(formatToolLabel('skill', { name: 'search-research' })).toBe('Skill (search-research)');
    expect(formatToolLabel('skill', {}, 'download-webpage')).toBe('Skill (download-webpage)');
    expect(formatToolLabel('skill', {})).toBe('Running skill');
  });

  // Case-insensitive kind matching
  it('handles capitalized kinds (ACP agents)', () => {
    expect(formatToolLabel('Read', { file_path: '/src/App.tsx' })).toBe('Reading App.tsx');
    expect(formatToolLabel('Write', { file_path: '/src/App.tsx' })).toBe('Editing App.tsx');
    expect(formatToolLabel('Bash', { command: 'ls' })).toBe('Running: ls');
    expect(formatToolLabel('Grep', { pattern: 'foo' })).toBe('Searching for "foo"');
  });
});

describe('parseRawInput', () => {
  it('parses JSON string', () => {
    expect(parseRawInput('{"path": "/foo/bar.ts"}')).toEqual({ path: '/foo/bar.ts' });
  });

  it('passes through objects', () => {
    expect(parseRawInput({ path: '/foo' })).toEqual({ path: '/foo' });
  });

  it('returns empty object for null/undefined', () => {
    expect(parseRawInput(undefined)).toEqual({});
    expect(parseRawInput(null)).toEqual({});
  });

  it('returns empty object for invalid JSON', () => {
    expect(parseRawInput('not json')).toEqual({});
  });

  it('returns empty object for non-object JSON', () => {
    expect(parseRawInput('"just a string"')).toEqual({});
  });

  it('returns empty object for JSON number', () => {
    expect(parseRawInput('42')).toEqual({});
  });

  it('returns empty object for empty string', () => {
    expect(parseRawInput('')).toEqual({});
  });
});

describe('normalizeToolCallContent', () => {
  it('returns empty array for non-array input', () => {
    expect(normalizeToolCallContent(null)).toEqual([]);
    expect(normalizeToolCallContent(undefined)).toEqual([]);
    expect(normalizeToolCallContent({})).toEqual([]);
    expect(normalizeToolCallContent('')).toEqual([]);
  });

  it('normalizes a Diff item with snake_case fields (ACP spec)', () => {
    const result = normalizeToolCallContent([
      { type: 'diff', path: '/src/App.tsx', old_text: 'old', new_text: 'new' },
    ]);
    expect(result).toEqual([
      { type: 'diff', path: '/src/App.tsx', oldText: 'old', newText: 'new' },
    ]);
  });

  it('accepts camelCase diff fields (tolerant parser)', () => {
    const result = normalizeToolCallContent([
      { type: 'diff', path: '/f', oldText: 'a', newText: 'b' },
    ]);
    expect(result).toEqual([{ type: 'diff', path: '/f', oldText: 'a', newText: 'b' }]);
  });

  it('treats a diff without old_text as a new file (undefined oldText)', () => {
    const result = normalizeToolCallContent([
      { type: 'diff', path: '/new.ts', new_text: 'hello' },
    ]);
    expect(result).toEqual([
      { type: 'diff', path: '/new.ts', oldText: undefined, newText: 'hello' },
    ]);
  });

  it('normalizes a Terminal item', () => {
    expect(
      normalizeToolCallContent([{ type: 'terminal', terminal_id: 'term-123' }]),
    ).toEqual([{ type: 'terminal', terminalId: 'term-123' }]);
    expect(
      normalizeToolCallContent([{ type: 'terminal', terminalId: 'term-456' }]),
    ).toEqual([{ type: 'terminal', terminalId: 'term-456' }]);
  });

  it('normalizes a Content variant that wraps a ContentBlock', () => {
    const result = normalizeToolCallContent([
      { type: 'content', content: { type: 'text', text: 'hello' } },
    ]);
    expect(result).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('normalizes a top-level text item', () => {
    const result = normalizeToolCallContent([{ type: 'text', text: 'terminal output' }]);
    expect(result).toEqual([{ type: 'text', text: 'terminal output' }]);
  });

  it('drops unknown variants silently', () => {
    const result = normalizeToolCallContent([
      { type: 'mysteryFuture', foo: 'bar' },
      { type: 'text', text: 'keep me' },
    ]);
    expect(result).toEqual([{ type: 'text', text: 'keep me' }]);
  });

  it('drops empty terminals and text-less content', () => {
    const result = normalizeToolCallContent([
      { type: 'terminal', terminal_id: '' },
      { type: 'content', content: { type: 'image', data: 'abc' } },
      { type: 'text' },
    ]);
    expect(result).toEqual([]);
  });

  it('preserves order of mixed items', () => {
    const result = normalizeToolCallContent([
      { type: 'content', content: { type: 'text', text: 'before' } },
      { type: 'diff', path: '/a', old_text: '1', new_text: '2' },
      { type: 'content', content: { type: 'text', text: 'after' } },
    ]);
    expect(result.map((r) => r.type)).toEqual(['text', 'diff', 'text']);
  });
});

describe('hasSessionCapability', () => {
  const withCaps = (caps: AcpAgentCapabilities['sessionCapabilities']): AcpAgentCapabilities => ({
    sessionCapabilities: caps,
  });
  const withSnakeCaps = (caps: AcpAgentCapabilities['session_capabilities']): AcpAgentCapabilities => ({
    session_capabilities: caps,
  });

  it('returns false when capabilities are null/undefined', () => {
    expect(hasSessionCapability(null, 'list')).toBe(false);
    expect(hasSessionCapability(undefined, 'fork')).toBe(false);
    expect(hasSessionCapability({}, 'resume')).toBe(false);
  });

  it('returns false when the sessionCapabilities block is absent', () => {
    const caps: AcpAgentCapabilities = { loadSession: true };
    expect(hasSessionCapability(caps, 'close')).toBe(false);
  });

  it('accepts snake_case payload as a fallback', () => {
    expect(hasSessionCapability(withSnakeCaps({ list: {} }), 'list')).toBe(true);
  });

  it('returns false when the sub-capability is null', () => {
    expect(hasSessionCapability(withCaps({ list: null }), 'list')).toBe(false);
  });

  it('returns false when the sub-capability is missing', () => {
    expect(hasSessionCapability(withCaps({ fork: {} }), 'close')).toBe(false);
  });

  it('returns true for any non-null object value', () => {
    expect(hasSessionCapability(withCaps({ list: {} }), 'list')).toBe(true);
    expect(hasSessionCapability(withCaps({ fork: { someField: true } }), 'fork')).toBe(true);
    expect(hasSessionCapability(withCaps({ resume: {} }), 'resume')).toBe(true);
    expect(hasSessionCapability(withCaps({ close: {} }), 'close')).toBe(true);
  });

  it('treats truthy primitives as supported (agents may serialize capability as bool)', () => {
    expect(hasSessionCapability(withCaps({ list: true as unknown }), 'list')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AuthMethodInfo — EnvVar discriminated-union round-trip
//
// Rust-side serde round-trip is tested in `src-tauri/src/commands/acp.rs`:
// `auth_method_info_env_var_serializes_vars_and_link`. The tests below assert
// the TypeScript consumer side: given a mocked `AcpSpawnResult` with an
// `env_var` method, `type: 'env_var'` narrows and exposes `vars[]` / `link`
// typed fields — the shape the generic EnvVar auth UI depends on.
// ---------------------------------------------------------------------------

describe('AuthMethodInfo discriminated union (EnvVar e2e)', () => {
  /** A mocked `AcpSpawnResult` as would be returned by `acp_agent_spawn`
   *  when the agent advertises an `AuthMethod::EnvVar` (see Rust `acp.rs`). */
  const MOCK_SPAWN_RESULT: AcpSpawnResult = {
    instance_id: 'inst-1',
    agent_name: 'gemini',
    agent_version: '1.0.0',
    auth_methods: [
      {
        type: 'env_var',
        id: 'api-key',
        name: 'API Key',
        description: 'Paste your Gemini key from Google AI Studio',
        vars: [
          { name: 'GEMINI_API_KEY', label: 'API Key', secret: true, optional: false },
        ],
        link: 'https://aistudio.google.com/app/apikey',
      },
    ],
    sandbox_enabled: false,
    network_sandbox_enabled: false,
    supports_images: false,
    capabilities: null,
  };

  it('preserves `vars[]` and `link` through the spawn payload', () => {
    const [method] = MOCK_SPAWN_RESULT.auth_methods;
    expect(method.type).toBe('env_var');

    if (method.type !== 'env_var') throw new Error('guard failed');

    // Discriminated-union narrowing must expose `vars` / `link` as typed fields.
    expectTypeOf(method.vars).toEqualTypeOf<AuthEnvVar[]>();
    expectTypeOf(method.link).toEqualTypeOf<string | null | undefined>();

    expect(method.vars).toHaveLength(1);
    expect(method.vars[0]).toEqual({
      name: 'GEMINI_API_KEY',
      label: 'API Key',
      secret: true,
      optional: false,
    });
    expect(method.link).toBe('https://aistudio.google.com/app/apikey');
  });

  it('agent-variant methods do NOT carry vars/link (narrowing blocks access)', () => {
    const agentMethod: AuthMethodInfo = {
      type: 'agent',
      id: 'default',
      name: 'Default',
      description: null,
    };
    expect(agentMethod.type).toBe('agent');

    if (agentMethod.type !== 'agent') throw new Error('guard failed');
    // `vars` / `link` are not present on the `agent` variant — this is
    // enforced at compile time by the discriminated union and confirmed
    // at runtime here.
    expect((agentMethod as unknown as Record<string, unknown>).vars).toBeUndefined();
    expect((agentMethod as unknown as Record<string, unknown>).link).toBeUndefined();
  });

  it('finds the first `env_var` method in a mixed list (the ConnectAgent pattern)', () => {
    // Mirrors the `findEnvVarAuthMethod` helper used by `ConnectAgent.tsx`.
    const methods: AuthMethodInfo[] = [
      { type: 'agent', id: 'oauth', name: 'OAuth' },
      {
        type: 'env_var',
        id: 'api-key',
        name: 'API Key',
        vars: [{ name: 'FOO', label: 'Foo', secret: true, optional: false }],
        link: 'https://example.com/keys',
      },
    ];
    const envVar = methods.find((m): m is AuthMethodInfo & { type: 'env_var' } => m.type === 'env_var');
    expect(envVar).toBeDefined();
    expect(envVar?.vars[0].name).toBe('FOO');
    expect(envVar?.link).toBe('https://example.com/keys');
  });
});

// ---------------------------------------------------------------------------
// getChatSandboxScope
// ---------------------------------------------------------------------------

describe('getChatSandboxScope', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projects: [],
      explorerFolders: [],
    });
  });

  function makeConnection(overrides: Partial<Connection> = {}): Connection {
    return {
      id: 'conn-1',
      provider: 'anthropic',
      authMethod: 'agent_managed',
      status: 'connected',
      label: 'Claude Code',
      credentials: { type: 'agent_managed', agentBinary: 'claude-agent-acp' },
      capabilities: ['interactive'],
      createdAt: 1,
      ...overrides,
    } as Connection;
  }

  it('normal mode: returns conv.projectPaths ∪ extraWritablePaths', () => {
    const conv = { projectPaths: ['/work/projA', '/work/projB'] };
    const connection = makeConnection({ extraWritablePaths: ['/tmp/agent-work'] });

    const scope = getChatSandboxScope(conv, connection, false);

    expect(scope.sort()).toEqual(['/tmp/agent-work', '/work/projA', '/work/projB']);
  });

  it('normal mode: ignores workspace projects/folders not in conv.projectPaths', () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/work/projA', fileTree: [] },
        { path: '/work/projB', fileTree: [] },
        { path: '/work/projC', fileTree: [] },
      ],
      explorerFolders: [{ path: '/elsewhere/explorer', fileTree: [] }],
    });
    const conv = { projectPaths: ['/work/projA'] };
    const connection = makeConnection();

    const scope = getChatSandboxScope(conv, connection, false);

    expect(scope).toEqual(['/work/projA']);
  });

  it('cross-project mode: unions ALL workspace paths + extraWritablePaths', () => {
    useWorkspaceStore.setState({
      projects: [
        { path: '/work/projA', fileTree: [] },
        { path: '/work/projB', fileTree: [] },
      ],
      explorerFolders: [{ path: '/elsewhere', fileTree: [] }],
    });
    const conv = { projectPaths: ['/work/projA'] };
    const connection = makeConnection({ extraWritablePaths: ['/tmp/agent-work'] });

    const scope = getChatSandboxScope(conv, connection, true);

    expect(scope.sort()).toEqual(['/elsewhere', '/tmp/agent-work', '/work/projA', '/work/projB']);
  });

  it('empty conv.projectPaths returns extraWritablePaths only', () => {
    const conv = { projectPaths: [] };
    const connection = makeConnection({ extraWritablePaths: ['/tmp/agent-work'] });

    expect(getChatSandboxScope(conv, connection, false)).toEqual(['/tmp/agent-work']);
  });

  it('no extraWritablePaths: just returns conv.projectPaths', () => {
    const conv = { projectPaths: ['/work/projA'] };
    const connection = makeConnection(); // no extraWritablePaths

    expect(getChatSandboxScope(conv, connection, false)).toEqual(['/work/projA']);
  });

  it('deduplicates when extraWritablePaths overlaps conv.projectPaths', () => {
    const conv = { projectPaths: ['/work/projA'] };
    const connection = makeConnection({ extraWritablePaths: ['/work/projA', '/tmp/agent-work'] });

    const scope = getChatSandboxScope(conv, connection, false);

    expect(scope.sort()).toEqual(['/tmp/agent-work', '/work/projA']);
    expect(scope.filter((p) => p === '/work/projA')).toHaveLength(1);
  });

  it('cross-project mode: deduplicates overlapping workspace + extraWritablePaths', () => {
    useWorkspaceStore.setState({
      projects: [{ path: '/work/projA', fileTree: [] }],
      explorerFolders: [{ path: '/work/projA', fileTree: [] }], // intentional duplicate
    });
    const conv = { projectPaths: ['/work/projA'] };
    const connection = makeConnection({ extraWritablePaths: ['/work/projA'] });

    const scope = getChatSandboxScope(conv, connection, true);

    expect(scope).toEqual(['/work/projA']);
  });

  it('returns a new array (not mutating inputs)', () => {
    const convPaths = ['/work/projA'];
    const extraPaths = ['/tmp/agent-work'];
    const conv = { projectPaths: convPaths };
    const connection = makeConnection({ extraWritablePaths: extraPaths });

    const scope = getChatSandboxScope(conv, connection, false);
    expect(scope).not.toBe(convPaths);
    expect(scope).not.toBe(extraPaths);
    expect(convPaths).toEqual(['/work/projA']); // unchanged
    expect(extraPaths).toEqual(['/tmp/agent-work']); // unchanged
  });
});

describe('buildAttachmentActivities (task #30)', () => {
  it('returns one `attachment` entry per path with basename label + full path detail', () => {
    const result = buildAttachmentActivities(
      ['/workspace/project-A/notes.md', '/workspace/project-A/research.md'],
      1700000000000,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      kind: 'attachment',
      label: 'notes.md',
      detail: '/workspace/project-A/notes.md',
      status: 'done',
      timestamp: 1700000000000,
    });
    expect(result[1]).toEqual({
      kind: 'attachment',
      label: 'research.md',
      detail: '/workspace/project-A/research.md',
      status: 'done',
      timestamp: 1700000000000,
    });
  });

  it('preserves order of paths', () => {
    const paths = [
      '/a/z.md',
      '/a/a.md',
      '/b/m.md',
    ];
    const result = buildAttachmentActivities(paths, 0);
    expect(result.map((a) => a.detail)).toEqual(paths);
  });

  it('returns empty array for undefined / empty input', () => {
    expect(buildAttachmentActivities(undefined)).toEqual([]);
    expect(buildAttachmentActivities([])).toEqual([]);
  });

  it('handles Windows-style paths and path with no slash', () => {
    const result = buildAttachmentActivities(
      ['C:\\Users\\peter\\notes.md', 'plainname.md'],
      42,
    );
    expect(result[0]).toMatchObject({ label: 'notes.md', detail: 'C:\\Users\\peter\\notes.md' });
    expect(result[1]).toMatchObject({ label: 'plainname.md', detail: 'plainname.md' });
  });
});
