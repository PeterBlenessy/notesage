import { describe, it, expect } from 'vitest';
import {
  extractPathsFromStructuredInput,
  extractAbsolutePathsFromCommand,
  isPathAllowed,
  isToolCallAllowed,
} from '../path-filter';

const HOME = '/Users/peter';
const PROJECT = '/Users/peter/Development/project-a';

// ---------------------------------------------------------------------------
// extractPathsFromStructuredInput
// ---------------------------------------------------------------------------

describe('extractPathsFromStructuredInput', () => {
  it('extracts file_path from JSON', () => {
    const input = JSON.stringify({ file_path: '/Users/peter/Development/project-a/src/main.ts' });
    expect(extractPathsFromStructuredInput(input)).toEqual([
      '/Users/peter/Development/project-a/src/main.ts',
    ]);
  });

  it('extracts multiple path fields', () => {
    const input = JSON.stringify({
      source: '/Users/peter/a/file.txt',
      destination: '/Users/peter/b/file.txt',
    });
    const paths = extractPathsFromStructuredInput(input);
    expect(paths).toContain('/Users/peter/a/file.txt');
    expect(paths).toContain('/Users/peter/b/file.txt');
  });

  it('extracts paths from array fields', () => {
    const input = JSON.stringify({ paths: ['/tmp/a.txt', '/tmp/b.txt'] });
    expect(extractPathsFromStructuredInput(input)).toEqual(['/tmp/a.txt', '/tmp/b.txt']);
  });

  it('ignores relative paths', () => {
    const input = JSON.stringify({ file_path: 'relative/path.ts' });
    expect(extractPathsFromStructuredInput(input)).toEqual([]);
  });

  it('ignores non-path fields', () => {
    const input = JSON.stringify({ content: '/looks/like/a/path', mode: 'read' });
    expect(extractPathsFromStructuredInput(input)).toEqual([]);
  });

  it('returns empty for invalid JSON', () => {
    expect(extractPathsFromStructuredInput('not json')).toEqual([]);
  });

  it('returns empty for empty string', () => {
    expect(extractPathsFromStructuredInput('')).toEqual([]);
  });

  it('returns empty for JSON primitive', () => {
    expect(extractPathsFromStructuredInput('"just a string"')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractAbsolutePathsFromCommand
// ---------------------------------------------------------------------------

describe('extractAbsolutePathsFromCommand', () => {
  it('finds absolute path in ls command', () => {
    expect(extractAbsolutePathsFromCommand('ls /Users/peter/other-project/')).toEqual([
      '/Users/peter/other-project/',
    ]);
  });

  it('finds quoted path', () => {
    expect(extractAbsolutePathsFromCommand('cat "/Users/peter/my project/file.txt"')).toEqual([
      '/Users/peter/my',
    ]);
    // Note: space-separated paths aren't fully captured — acceptable limitation
  });

  it('finds multiple paths', () => {
    const paths = extractAbsolutePathsFromCommand('cp /tmp/a.txt /Users/peter/b.txt');
    expect(paths).toContain('/tmp/a.txt');
    expect(paths).toContain('/Users/peter/b.txt');
  });

  it('returns empty for command with no absolute paths', () => {
    expect(extractAbsolutePathsFromCommand('git status')).toEqual([]);
  });

  it('returns empty for empty command', () => {
    expect(extractAbsolutePathsFromCommand('')).toEqual([]);
  });

  it('deduplicates repeated paths', () => {
    const paths = extractAbsolutePathsFromCommand('ls /tmp/a.txt && cat /tmp/a.txt');
    expect(paths).toEqual(['/tmp/a.txt']);
  });

  it('finds path after equals sign', () => {
    const paths = extractAbsolutePathsFromCommand('HOME=/Users/peter/fake');
    expect(paths).toContain('/Users/peter/fake');
  });
});

// ---------------------------------------------------------------------------
// isPathAllowed
// ---------------------------------------------------------------------------

describe('isPathAllowed', () => {
  it('allows path within project root', () => {
    expect(isPathAllowed('/Users/peter/Development/project-a/src/main.ts', PROJECT, HOME)).toBe(true);
  });

  it('allows the project root itself', () => {
    expect(isPathAllowed(PROJECT, PROJECT, HOME)).toBe(true);
  });

  it('allows project root with trailing slash', () => {
    expect(isPathAllowed(PROJECT + '/', PROJECT, HOME)).toBe(true);
  });

  it('denies path in another project', () => {
    expect(isPathAllowed('/Users/peter/Development/project-b/src/main.ts', PROJECT, HOME)).toBe(false);
  });

  it('denies path that is a prefix match but different dir', () => {
    // project-a-extra should NOT match project-a
    expect(isPathAllowed('/Users/peter/Development/project-a-extra/file.txt', PROJECT, HOME)).toBe(false);
  });

  it('allows /tmp paths', () => {
    expect(isPathAllowed('/tmp/scratch.txt', PROJECT, HOME)).toBe(true);
  });

  it('allows /private/tmp paths', () => {
    expect(isPathAllowed('/private/tmp/scratch.txt', PROJECT, HOME)).toBe(true);
  });

  it('allows /usr paths', () => {
    expect(isPathAllowed('/usr/bin/node', PROJECT, HOME)).toBe(true);
  });

  it('allows /System paths', () => {
    expect(isPathAllowed('/System/Library/Frameworks/Something', PROJECT, HOME)).toBe(true);
  });

  it('allows ~/.claude config dir', () => {
    expect(isPathAllowed('/Users/peter/.claude/settings.json', PROJECT, HOME)).toBe(true);
  });

  it('allows ~/.notesage config dir', () => {
    expect(isPathAllowed('/Users/peter/.notesage/agents/foo.md', PROJECT, HOME)).toBe(true);
  });

  it('allows ~/.config dir', () => {
    expect(isPathAllowed('/Users/peter/.config/something', PROJECT, HOME)).toBe(true);
  });

  it('allows ~/.cargo dir', () => {
    expect(isPathAllowed('/Users/peter/.cargo/bin/rustc', PROJECT, HOME)).toBe(true);
  });

  it('denies ~/Documents (not a safe home dir)', () => {
    expect(isPathAllowed('/Users/peter/Documents/secret.txt', PROJECT, HOME)).toBe(false);
  });

  it('denies ~/Desktop', () => {
    expect(isPathAllowed('/Users/peter/Desktop/file.txt', PROJECT, HOME)).toBe(false);
  });

  it('denies ~/.ssh', () => {
    expect(isPathAllowed('/Users/peter/.ssh/id_rsa', PROJECT, HOME)).toBe(false);
  });

  it('denies ~/.aws', () => {
    expect(isPathAllowed('/Users/peter/.aws/credentials', PROJECT, HOME)).toBe(false);
  });

  it('denies home dir itself', () => {
    expect(isPathAllowed('/Users/peter', PROJECT, HOME)).toBe(false);
  });

  it('denies another users home', () => {
    expect(isPathAllowed('/Users/other/Development/project-a/file.txt', PROJECT, HOME)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isToolCallAllowed
// ---------------------------------------------------------------------------

describe('isToolCallAllowed', () => {
  describe('structured tools (read, write, etc.)', () => {
    it('allows read within project', () => {
      const input = JSON.stringify({ file_path: PROJECT + '/src/main.ts' });
      expect(isToolCallAllowed('read', input, PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('denies read targeting another project', () => {
      const input = JSON.stringify({ file_path: '/Users/peter/Development/project-b/secrets.env' });
      const result = isToolCallAllowed('read', input, PROJECT, HOME);
      expect(result.allowed).toBe(false);
      expect(result.deniedPath).toBe('/Users/peter/Development/project-b/secrets.env');
    });

    it('allows write to project file', () => {
      const input = JSON.stringify({ file_path: PROJECT + '/output.txt' });
      expect(isToolCallAllowed('write', input, PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('denies write to another project', () => {
      const input = JSON.stringify({ file_path: '/Users/peter/Development/project-b/output.txt' });
      expect(isToolCallAllowed('write', input, PROJECT, HOME).allowed).toBe(false);
    });

    it('allows read of system path', () => {
      const input = JSON.stringify({ file_path: '/usr/local/bin/node' });
      expect(isToolCallAllowed('read', input, PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('allows glob within project', () => {
      const input = JSON.stringify({ path: PROJECT + '/src' });
      expect(isToolCallAllowed('glob', input, PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('allows agent config path', () => {
      const input = JSON.stringify({ file_path: HOME + '/.claude/settings.json' });
      expect(isToolCallAllowed('read', input, PROJECT, HOME)).toEqual({ allowed: true });
    });
  });

  describe('terminal/bash tools', () => {
    it('allows command with no absolute paths', () => {
      expect(isToolCallAllowed('bash', 'git status', PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('allows command with project path', () => {
      expect(isToolCallAllowed('bash', `ls ${PROJECT}/src`, PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('denies command with path to other project', () => {
      const result = isToolCallAllowed('bash', 'cat /Users/peter/Development/project-b/secret.txt', PROJECT, HOME);
      expect(result.allowed).toBe(false);
    });

    it('allows command with /tmp path', () => {
      expect(isToolCallAllowed('bash', 'cat /tmp/output.log', PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('handles JSON-wrapped terminal command', () => {
      const input = JSON.stringify({ command: `cat /Users/peter/Development/project-b/file.txt` });
      const result = isToolCallAllowed('bash', input, PROJECT, HOME);
      expect(result.allowed).toBe(false);
    });

    it('allows JSON-wrapped command within project', () => {
      const input = JSON.stringify({ command: `ls ${PROJECT}` });
      expect(isToolCallAllowed('bash', input, PROJECT, HOME)).toEqual({ allowed: true });
    });
  });

  describe('unknown tool kinds', () => {
    it('tries structured extraction as fallback', () => {
      const input = JSON.stringify({ file_path: '/Users/peter/Development/project-b/x.txt' });
      const result = isToolCallAllowed('some_new_tool', input, PROJECT, HOME);
      expect(result.allowed).toBe(false);
    });

    it('allows when no paths found', () => {
      expect(isToolCallAllowed('some_new_tool', 'no paths here', PROJECT, HOME)).toEqual({ allowed: true });
    });
  });

  describe('edge cases', () => {
    it('allows when rawInput is empty', () => {
      expect(isToolCallAllowed('read', '', PROJECT, HOME)).toEqual({ allowed: true });
    });

    it('handles project root with trailing slash', () => {
      const input = JSON.stringify({ file_path: PROJECT + '/file.txt' });
      expect(isToolCallAllowed('read', input, PROJECT + '/', HOME)).toEqual({ allowed: true });
    });

    it('denies prefix-matching project name (project-a-extra vs project-a)', () => {
      const input = JSON.stringify({ file_path: '/Users/peter/Development/project-a-extra/file.txt' });
      expect(isToolCallAllowed('read', input, PROJECT, HOME).allowed).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Multi-root support (task #6)
  //
  // Red-team invariants that codify "agent scoped to projects A+B cannot
  // touch project C". A path is allowed iff it lies inside ANY configured
  // project root (or system / safe-home dirs). Single-string callers MUST
  // continue to work — same semantics, single-element array.
  // -------------------------------------------------------------------------
  describe('multi-root support', () => {
    const PROJECT_B = '/Users/peter/Development/project-b';
    const PROJECT_C = '/Users/peter/Development/project-c';

    it('allows path inside any of the configured roots', () => {
      const input = JSON.stringify({ file_path: PROJECT_B + '/src/main.ts' });
      expect(isToolCallAllowed('read', input, [PROJECT, PROJECT_B], HOME)).toEqual({ allowed: true });
    });

    it('allows path inside the first root', () => {
      const input = JSON.stringify({ file_path: PROJECT + '/src/main.ts' });
      expect(isToolCallAllowed('read', input, [PROJECT, PROJECT_B], HOME)).toEqual({ allowed: true });
    });

    it('denies path outside every configured root', () => {
      const input = JSON.stringify({ file_path: PROJECT_C + '/secret.env' });
      const result = isToolCallAllowed('read', input, [PROJECT, PROJECT_B], HOME);
      expect(result.allowed).toBe(false);
      expect(result.deniedPath).toBe(PROJECT_C + '/secret.env');
    });

    it('denies bash command targeting a path outside every root', () => {
      const result = isToolCallAllowed(
        'bash',
        `cat ${PROJECT_C}/secret.env`,
        [PROJECT, PROJECT_B],
        HOME,
      );
      expect(result.allowed).toBe(false);
    });

    it('still allows system paths regardless of root list', () => {
      const input = JSON.stringify({ file_path: '/usr/local/bin/node' });
      expect(isToolCallAllowed('read', input, [PROJECT, PROJECT_B], HOME)).toEqual({ allowed: true });
    });

    it('treats single-element array identically to legacy string arg', () => {
      const input = JSON.stringify({ file_path: PROJECT_B + '/file.txt' });
      const arrayResult = isToolCallAllowed('read', input, [PROJECT], HOME);
      const stringResult = isToolCallAllowed('read', input, PROJECT, HOME);
      expect(arrayResult).toEqual(stringResult);
      expect(arrayResult.allowed).toBe(false);
    });

    it('denies when roots array is empty (no project => no allowed path)', () => {
      const input = JSON.stringify({ file_path: PROJECT + '/file.txt' });
      expect(isToolCallAllowed('read', input, [], HOME).allowed).toBe(false);
    });

    it('allows system path even when roots array is empty', () => {
      const input = JSON.stringify({ file_path: '/tmp/scratch.txt' });
      expect(isToolCallAllowed('read', input, [], HOME)).toEqual({ allowed: true });
    });
  });
});
