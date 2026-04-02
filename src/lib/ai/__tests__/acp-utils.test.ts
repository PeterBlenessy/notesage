import { describe, it, expect } from 'vitest';
import { formatToolLabel, parseRawInput } from '../acp-utils';

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
    expect(formatToolLabel('read', {}, 'config.ts')).toBe('config.ts');  // title used as fallback label
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
